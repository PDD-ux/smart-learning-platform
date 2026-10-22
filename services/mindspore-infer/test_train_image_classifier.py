"""三分类训练的纯逻辑测试；无需安装 MindSpore。"""

from __future__ import annotations

import unittest

import numpy as np

from scripts.train_image_classifier import class_weights, validation_metrics


class TrainClassifierLogicTests(unittest.TestCase):
    def test_weights_use_train_counts_in_label_order(self) -> None:
        weights = class_weights(
            {"blackboard": 335, "screen": 1333, "invalid": 108},
            ("blackboard", "screen", "invalid"),
            0.5,
        )
        self.assertAlmostEqual(float(weights[1]), 1.0)
        self.assertGreater(float(weights[2]), float(weights[0]))
        self.assertGreater(float(weights[0]), float(weights[1]))

    def test_macro_recall_exposes_invalid_failure(self) -> None:
        confusion = np.asarray([[335, 11, 0], [25, 213, 0], [14, 57, 19]])
        accuracy, macro_recall, recalls = validation_metrics(confusion)
        self.assertAlmostEqual(accuracy, 567 / 674)
        self.assertAlmostEqual(float(recalls[2]), 19 / 90)
        self.assertLess(macro_recall, accuracy)


if __name__ == "__main__":
    unittest.main()
