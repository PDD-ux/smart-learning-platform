#!/usr/bin/env python3
"""Run a single-image ACL smoke test for an Ascend OM classifier."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
from typing import Sequence


def _check_acl(result: object, operation: str) -> object:
    """Unwrap ACL's (value, status) returns and raise on nonzero status."""
    if isinstance(result, tuple):
        value = result[0]
        status = result[-1]
    else:
        value = result
        status = result
    if status != 0:
        raise RuntimeError(f"{operation} failed with ACL status {status}")
    return value


def _parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="Ascend .om file")
    parser.add_argument("--checkpoint", type=Path, help="optional matching .ckpt; required for external-weight OM, or to compare CPU logits")
    parser.add_argument("--device-id", type=int, default=0)
    parser.add_argument("--input-image", type=Path, help="optional JPG/PNG; resized and normalized with the training pipeline")
    parser.add_argument("--report", type=Path, help="optional JSON report path")
    return parser.parse_args(argv)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for block in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    if not args.model.is_file():
        raise FileNotFoundError(f"OM file not found: {args.model}")
    if args.checkpoint is not None and not args.checkpoint.is_file():
        raise FileNotFoundError(f"checkpoint not found: {args.checkpoint}")

    import acl
    import numpy as np
    parameters = {}
    input_array = np.zeros((1, 3, 224, 224), dtype=np.float32)
    reference_logits = None
    if args.input_image is not None and not args.input_image.is_file():
        raise FileNotFoundError(f"input image not found: {args.input_image}")
    if args.checkpoint is not None or args.input_image is not None:
        import mindspore as ms
        from mindspore.dataset import vision
        if args.input_image is not None:
            decoded = vision.Decode()(args.input_image.read_bytes())
            resized = vision.Resize((224, 224))(decoded)
            chw = vision.HWC2CHW()(resized)
            input_array = np.expand_dims(vision.Rescale(1.0 / 255.0, 0.0)(chw), axis=0).astype(np.float32)
        if args.checkpoint is not None:
            parameters = ms.load_checkpoint(str(args.checkpoint))
            sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
            from models import create_model
            ms.set_context(device_target="CPU")
            reference_net = create_model("classifier")
            missing, unexpected = ms.load_param_into_net(reference_net, parameters)
            if missing or unexpected:
                raise RuntimeError(f"checkpoint/model mismatch: missing={missing}, unexpected={unexpected}")
            reference_net.set_train(False)
            reference_logits = reference_net(ms.Tensor(input_array)).asnumpy().reshape(-1).tolist()
    initialized = False
    context = None
    model_id = None
    model_desc = None
    input_dataset = None
    output_dataset = None
    device_allocations: list[int] = []
    input_buffers: list[int] = []
    output_buffers: list[int] = []
    host_allocations: list[int] = []
    try:
        _check_acl(acl.init(), "acl.init")
        initialized = True
        device_count = int(_check_acl(acl.rt.get_device_count(), "get_device_count"))
        if args.device_id < 0 or args.device_id >= device_count:
            raise ValueError(f"device-id {args.device_id} is outside 0..{device_count - 1}")
        _check_acl(acl.rt.set_device(args.device_id), "set_device")
        context = _check_acl(acl.rt.create_context(args.device_id), "create_context")
        model_id = _check_acl(acl.mdl.load_from_file(str(args.model)), "load_from_file")
        model_desc = acl.mdl.create_desc()
        _check_acl(acl.mdl.get_desc(model_desc, model_id), "get_desc")

        input_count = int(acl.mdl.get_num_inputs(model_desc))
        output_count = int(acl.mdl.get_num_outputs(model_desc))
        if args.checkpoint is None and input_count != 1:
            raise RuntimeError(
                f"OM has {input_count} inputs; without a checkpoint, expected a self-contained one-image model"
            )
        if args.checkpoint is not None and input_count not in (1, len(parameters) + 1):
            raise RuntimeError(
                f"OM has {input_count} inputs; expected one embedded-weight image input or one image plus {len(parameters)} checkpoint parameters"
            )

        # ACL Python bindings in the tested CANN release expose enum values as integers.
        malloc_huge_first = 0
        memcpy_host_to_device = 1
        memcpy_device_to_host = 2
        input_dataset = acl.mdl.create_dataset()
        unmatched_input_names: list[str] = []
        for index in range(input_count):
            dims = _check_acl(acl.mdl.get_input_dims(model_desc, index), f"get_input_dims[{index}]")
            input_name = str(dims["name"])
            input_size = int(acl.mdl.get_input_size_by_index(model_desc, index))
            if input_name in parameters:
                payload = parameters[input_name].data.asnumpy().tobytes(order="C")
            else:
                unmatched_input_names.append(input_name)
                if input_array is None or input_array.nbytes != input_size:
                    raise RuntimeError(
                        f"image input {input_name} expects {input_size} bytes, got {None if input_array is None else input_array.nbytes}"
                    )
                payload = input_array.tobytes(order="C")
            if len(payload) != input_size:
                raise RuntimeError(
                    f"input {input_name} expects {input_size} bytes, got {len(payload)}"
                )
            device_ptr, status = acl.rt.malloc(input_size, malloc_huge_first)
            _check_acl(status, f"malloc[{input_name}]")
            device_allocations.append(device_ptr)
            host_ptr = acl.util.bytes_to_ptr(payload)
            _check_acl(
                acl.rt.memcpy(device_ptr, input_size, host_ptr, input_size, memcpy_host_to_device),
                f"copy_input[{input_name}]",
            )
            data_buffer = acl.create_data_buffer(device_ptr, input_size)
            if not data_buffer:
                raise RuntimeError(f"create_data_buffer returned null for {input_name}")
            input_buffers.append(data_buffer)
            _check_acl(acl.mdl.add_dataset_buffer(input_dataset, data_buffer), f"add_input[{input_name}]")
        if len(unmatched_input_names) != 1:
            raise RuntimeError(
                "OM must expose exactly one non-checkpoint image input; "
                f"found {unmatched_input_names}"
            )

        output_dataset = acl.mdl.create_dataset()
        output_specs: list[tuple[int, int, dict[str, object]]] = []
        for index in range(output_count):
            output_size = int(acl.mdl.get_output_size_by_index(model_desc, index))
            output_dtype = int(acl.mdl.get_output_data_type(model_desc, index))
            output_dims = _check_acl(acl.mdl.get_output_dims(model_desc, index), f"get_output_dims[{index}]")
            device_ptr, status = acl.rt.malloc(output_size, malloc_huge_first)
            _check_acl(status, f"malloc_output[{index}]")
            device_allocations.append(device_ptr)
            data_buffer = acl.create_data_buffer(device_ptr, output_size)
            if not data_buffer:
                raise RuntimeError(f"create_data_buffer returned null for output {index}")
            output_buffers.append(data_buffer)
            _check_acl(acl.mdl.add_dataset_buffer(output_dataset, data_buffer), f"add_output[{index}]")
            output_specs.append((output_size, output_dtype, output_dims))

        _check_acl(acl.mdl.execute(model_id, input_dataset, output_dataset), "execute")
        outputs: list[dict[str, object]] = []
        for index, (output_size, output_dtype, output_dims) in enumerate(output_specs):
            output_buffer = acl.mdl.get_dataset_buffer(output_dataset, index)
            device_ptr = acl.get_data_buffer_addr(output_buffer)
            host_ptr, status = acl.rt.malloc_host(output_size)
            _check_acl(status, f"malloc_host_output[{index}]")
            host_allocations.append(host_ptr)
            _check_acl(
                acl.rt.memcpy(host_ptr, output_size, device_ptr, output_size, memcpy_device_to_host),
                f"copy_output[{index}]",
            )
            raw_output = acl.util.ptr_to_bytes(host_ptr, output_size)
            if output_dtype == 0 and output_size % 4 == 0:
                values = struct.unpack("<" + "f" * (output_size // 4), raw_output)
                if not all(math.isfinite(value) for value in values):
                    raise RuntimeError(f"output {index} contains NaN or infinity")
                outputs.append(
                    {
                        "name": output_dims["name"],
                        "shape": output_dims["dims"],
                        "dtype": "float32",
                        "values": list(values),
                        "top_index": max(range(len(values)), key=values.__getitem__),
                    }
                )
            else:
                outputs.append(
                    {
                        "name": output_dims["name"],
                        "shape": output_dims["dims"],
                        "dtype_code": output_dtype,
                        "bytes": output_size,
                    }
                )

        cpu_max_abs_diff = (
            max(abs(left - right) for left, right in zip(outputs[0]["values"], reference_logits))
            if reference_logits is not None and outputs and len(outputs[0].get("values", [])) == len(reference_logits)
            else None
        )
        if cpu_max_abs_diff is not None and cpu_max_abs_diff > 0.01:
            raise RuntimeError(f"ACL logits differ from MindSpore CPU by {cpu_max_abs_diff:.6f} (tolerance 0.01)")

        report: dict[str, object] = {
            "result": "PASS",
            "test": "ACL single-image inference smoke test",
            "device_id": args.device_id,
            "device_count": device_count,
            "input_count": input_count,
            "checkpoint_parameter_count": len(parameters),
            "checkpoint_parameter_inputs": input_count - 1,
            "weights_embedded": input_count == 1,
            "image_input_names": unmatched_input_names,
            "input_image": args.input_image.name if args.input_image is not None else "zero-tensor",
            "outputs": outputs,
            "mindspore_cpu_logits": reference_logits,
            "cpu_max_abs_diff": cpu_max_abs_diff,
            "cpu_max_abs_diff_tolerance": 0.01 if reference_logits is not None else None,
            "model_bytes": args.model.stat().st_size,
            "model_sha256": _sha256(args.model),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 0
    finally:
        for pointer in reversed(host_allocations):
            try:
                acl.rt.free_host(pointer)
            except Exception:
                pass
        if output_dataset is not None:
            for buffer in output_buffers:
                try:
                    acl.destroy_data_buffer(buffer)
                except Exception:
                    pass
            try:
                acl.mdl.destroy_dataset(output_dataset)
            except Exception:
                pass
        if input_dataset is not None:
            for buffer in input_buffers:
                try:
                    acl.destroy_data_buffer(buffer)
                except Exception:
                    pass
            try:
                acl.mdl.destroy_dataset(input_dataset)
            except Exception:
                pass
        for pointer in reversed(device_allocations):
            try:
                acl.rt.free(pointer)
            except Exception:
                pass
        if model_desc is not None:
            try:
                acl.mdl.destroy_desc(model_desc)
            except Exception:
                pass
        if model_id is not None:
            try:
                acl.mdl.unload(model_id)
            except Exception:
                pass
        if context is not None:
            try:
                acl.rt.destroy_context(context)
            except Exception:
                pass
        if initialized:
            try:
                acl.rt.reset_device(args.device_id)
            except Exception:
                pass
            try:
                acl.finalize()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
