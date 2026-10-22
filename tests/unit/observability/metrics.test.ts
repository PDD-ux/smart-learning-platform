import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetMetricsForTest,
  recordCounter,
  recordLatency,
  renderPrometheusMetrics,
} from '@/lib/observability/metrics';

describe('Prometheus metrics', () => {
  afterEach((): void => {
    __resetMetricsForTest();
  });

  it('renders counters and the P95 summary in Prometheus text format', () => {
    recordCounter('slp_import_jobs_total', { outcome: 'success' });
    recordCounter('slp_import_jobs_total', { outcome: 'success' });
    recordLatency('slp_mindspore_request_duration_seconds', 10, { operation: 'classify', outcome: 'success' });
    recordLatency('slp_mindspore_request_duration_seconds', 100, { operation: 'classify', outcome: 'success' });

    const output = renderPrometheusMetrics();

    expect(output).toContain('slp_import_jobs_total{outcome="success"} 2');
    expect(output).toContain('slp_mindspore_request_duration_seconds{operation="classify",outcome="success",quantile="0.95"} 0.1');
    expect(output).toContain('slp_mindspore_request_duration_seconds_count{operation="classify",outcome="success"} 2');
  });
});
