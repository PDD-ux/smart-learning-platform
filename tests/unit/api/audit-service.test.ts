import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: { auditLog: { create: mocks.create } } }));

import { recordAudit } from '@/lib/audit/audit-service';

describe('recordAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({});
  });

  it('writes actor, object, action, result, source IP and detail with DB timestamp default', async () => {
    await recordAudit({
      actorId: 'user-1', objectId: 'content-1', action: 'content.delete',
      result: 'success', ip: '203.0.113.10', detail: 'cascade requested',
    });

    expect(mocks.create).toHaveBeenCalledWith({ data: {
      actorId: 'user-1', objectId: 'content-1', action: 'content.delete',
      result: 'success', ip: '203.0.113.10', detail: 'cascade requested',
    } });
  });

  it('defaults result and nullable metadata and supports a transaction client', async () => {
    const transactionalCreate = vi.fn(async () => ({}));
    const tx = { auditLog: { create: transactionalCreate } };
    await recordAudit({ actorId: 'user-1', objectId: 'content-2', action: 'note.export' }, tx as unknown as Prisma.TransactionClient);

    expect(transactionalCreate).toHaveBeenCalledWith({ data: {
      actorId: 'user-1', objectId: 'content-2', action: 'note.export',
      result: 'success', ip: null, detail: null,
    } });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
