import { describe, expect, it } from 'vitest';
import { PermissionsBitField, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { isAdmin } from '../../../src/presentation/discord/commands/admin/adminAuth.js';
import { env } from '../../../src/config/env.js';
import type { AppDependencies } from '../../../src/presentation/discord/AppDependencies.js';

function makeInteraction(opts: {
  isAdministrator?: boolean;
  roleIds?: string[];
}): ChatInputCommandInteraction {
  const memberPermissions = new PermissionsBitField(
    opts.isAdministrator ? PermissionFlagsBits.Administrator : 0n,
  );
  return {
    memberPermissions,
    member: {
      roles: { cache: new Map((opts.roleIds ?? []).map((id) => [id, id])) },
    },
  } as unknown as ChatInputCommandInteraction;
}

function makeDeps(adminRoleIds: string[]): AppDependencies {
  return { env: { ...env, ADMIN_ROLE_IDS: adminRoleIds } } as AppDependencies;
}

describe('isAdmin', () => {
  it('always allows a real Discord Administrator, even with no ADMIN_ROLE_IDS configured', () => {
    const interaction = makeInteraction({ isAdministrator: true });
    expect(isAdmin(interaction, makeDeps([]))).toBe(true);
  });

  it('denies a non-administrator when ADMIN_ROLE_IDS is empty (no configured escrow-admin role)', () => {
    const interaction = makeInteraction({ isAdministrator: false });
    expect(isAdmin(interaction, makeDeps([]))).toBe(false);
  });

  it('allows a member holding a configured admin role', () => {
    const interaction = makeInteraction({ isAdministrator: false, roleIds: ['role-1'] });
    expect(isAdmin(interaction, makeDeps(['role-1', 'role-2']))).toBe(true);
  });

  it('denies a member without the configured admin role and without Administrator', () => {
    const interaction = makeInteraction({ isAdministrator: false, roleIds: ['role-3'] });
    expect(isAdmin(interaction, makeDeps(['role-1', 'role-2']))).toBe(false);
  });
});
