/**
 * 进程内 Prometheus 指标注册表。
 *
 * 此实现不引入额外依赖，适合 MVP 与单进程开发。容器化多副本部署时，
 * Prometheus 应分别抓取每个 Web/worker 进程；聚合、告警与长期存储交给
 * Prometheus/Grafana，而不是在应用内保存。
 */

type LabelValue = string | number | boolean;
type MetricLabels = Record<string, LabelValue>;

export type CounterMetric =
  | 'slp_import_jobs_total'
  | 'slp_pipeline_stages_total'
  | 'slp_mindspore_requests_total'
  | 'slp_llm_requests_total'
  | 'slp_vision_ocr_requests_total'
  | 'slp_flashcard_reviews_total';

export type LatencyMetric =
  | 'slp_mindspore_request_duration_seconds'
  | 'slp_llm_request_duration_seconds'
  | 'slp_vision_ocr_duration_seconds';

type CounterDefinition = { help: string };
type LatencyDefinition = { help: string };
type CounterSample = { labels: MetricLabels; value: number };
type LatencySample = { labels: MetricLabels; values: number[]; sum: number };

const COUNTERS: Record<CounterMetric, CounterDefinition> = {
  slp_import_jobs_total: { help: 'Content import jobs by final outcome.' },
  slp_pipeline_stages_total: { help: 'Pipeline stages by queue, stage and outcome.' },
  slp_mindspore_requests_total: { help: 'MindSpore inference requests by operation and outcome.' },
  slp_llm_requests_total: { help: 'LLM requests by operation and outcome.' },
  slp_vision_ocr_requests_total: { help: 'Cloud vision OCR fallback requests by model and outcome.' },
  slp_flashcard_reviews_total: { help: 'Successful flashcard reviews by rating.' },
};

const LATENCIES: Record<LatencyMetric, LatencyDefinition> = {
  slp_mindspore_request_duration_seconds: { help: 'MindSpore inference request latency in seconds.' },
  slp_llm_request_duration_seconds: { help: 'LLM request latency in seconds.' },
  slp_vision_ocr_duration_seconds: { help: 'Cloud vision OCR fallback latency in seconds.' },
};

const MAX_LATENCY_SAMPLES = 512;

type MetricStore = {
  counters: Map<string, CounterSample>;
  latencies: Map<string, LatencySample>;
};

const globalForMetrics = globalThis as unknown as { __slpPrometheusMetrics?: MetricStore };

function store(): MetricStore {
  if (!globalForMetrics.__slpPrometheusMetrics) {
    globalForMetrics.__slpPrometheusMetrics = { counters: new Map(), latencies: new Map() };
  }
  return globalForMetrics.__slpPrometheusMetrics;
}

function normalizedLabels(labels: MetricLabels): MetricLabels {
  return Object.fromEntries(
    Object.entries(labels)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, String(value)]),
  );
}

function sampleKey(name: string, labels: MetricLabels): string {
  return `${name}:${JSON.stringify(normalizedLabels(labels))}`;
}

function escapeLabel(value: LabelValue): string {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function labelSuffix(labels: MetricLabels): string {
  const entries = Object.entries(normalizedLabels(labels));
  if (entries.length === 0) return '';
  return `{${entries.map(([key, value]) => `${key}="${escapeLabel(value)}"`).join(',')}}`;
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)] ?? 0;
}

export function recordCounter(metric: CounterMetric, labels: MetricLabels = {}, amount = 1): void {
  const normalized = normalizedLabels(labels);
  const key = sampleKey(metric, normalized);
  const current = store().counters.get(key);
  if (current) {
    current.value += amount;
    return;
  }
  store().counters.set(key, { labels: normalized, value: amount });
}

export function recordLatency(metric: LatencyMetric, durationMs: number, labels: MetricLabels = {}): void {
  const normalized = normalizedLabels(labels);
  const key = sampleKey(metric, normalized);
  const seconds = Math.max(0, durationMs) / 1_000;
  const current = store().latencies.get(key);
  if (current) {
    current.values.push(seconds);
    if (current.values.length > MAX_LATENCY_SAMPLES) current.values.shift();
    current.sum += seconds;
    return;
  }
  store().latencies.set(key, { labels: normalized, values: [seconds], sum: seconds });
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = [];
  for (const [metric, definition] of Object.entries(COUNTERS) as [CounterMetric, CounterDefinition][]) {
    lines.push(`# HELP ${metric} ${definition.help}`, `# TYPE ${metric} counter`);
    for (const [key, sample] of store().counters) {
      if (key.startsWith(`${metric}:`)) lines.push(`${metric}${labelSuffix(sample.labels)} ${sample.value}`);
    }
  }
  for (const [metric, definition] of Object.entries(LATENCIES) as [LatencyMetric, LatencyDefinition][]) {
    lines.push(`# HELP ${metric} ${definition.help}`, `# TYPE ${metric} summary`);
    for (const [key, sample] of store().latencies) {
      if (!key.startsWith(`${metric}:`)) continue;
      lines.push(`${metric}${labelSuffix({ ...sample.labels, quantile: '0.95' })} ${percentile(sample.values, 0.95)}`);
      lines.push(`${metric}_sum${labelSuffix(sample.labels)} ${sample.sum}`);
      lines.push(`${metric}_count${labelSuffix(sample.labels)} ${sample.values.length}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** 仅供测试隔离全局内存态。 */
export function __resetMetricsForTest(): void {
  globalForMetrics.__slpPrometheusMetrics = { counters: new Map(), latencies: new Map() };
}
