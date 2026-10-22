import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '@/lib/auth/password';

describe('password hashing', () => {
  it('stores only a cost-12 bcrypt hash and verifies matching passwords', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(hash).not.toContain('correct horse');
    await expect(verifyPassword('correct horse battery staple', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong password', hash)).resolves.toBe(false);
  });
});
