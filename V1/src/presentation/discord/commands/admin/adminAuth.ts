import { MessageFlags, PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import type { AppDependencies } from '../../AppDependencies.js';

/**
 * Admin role membership genuinely lives in Discord (who has which role),
 * not in our database — so this reads the interacting member's live role
 * cache/permissions and checks against configured ADMIN_ROLE_IDS. This is
 * the authoritative check; use cases additionally re-validate that the
 * actor isn't spoofable at the domain layer where that's actually possible
 * (buyer/seller identity), but role membership can only be verified here,
 * against real-time Discord state.
 *
 * A real Discord Administrator always passes, regardless of ADMIN_ROLE_IDS —
 * this is deliberate so an operator who hasn't configured a dedicated
 * escrow-admin role (or configures it wrong) is never locked out of their
 * own bot. Setting ADMIN_ROLE_IDS narrows admin access to specific roles on
 * top of that floor; it is never the only path to admin access.
 */
export function isAdmin(interaction: ChatInputCommandInteraction, deps: AppDependencies): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;

  if (deps.env.ADMIN_ROLE_IDS.length === 0) return false;
  const memberRoles = interaction.member?.roles;
  if (!memberRoles) return false;
  // interaction.member.roles is a GuildMemberRoleManager when the member is
  // cached (normal case), or a raw string[] of role ids for an uncached
  // partial member — handle both rather than assuming the richer type.
  if (Array.isArray(memberRoles)) {
    return deps.env.ADMIN_ROLE_IDS.some((roleId) => memberRoles.includes(roleId));
  }
  return deps.env.ADMIN_ROLE_IDS.some((roleId) => memberRoles.cache.has(roleId));
}

export async function requireAdmin(
  interaction: ChatInputCommandInteraction,
  deps: AppDependencies,
): Promise<boolean> {
  if (isAdmin(interaction, deps)) return true;
  await interaction.reply({
    content: 'This command is restricted to escrow admins.',
    flags: MessageFlags.Ephemeral,
  });
  return false;
}
