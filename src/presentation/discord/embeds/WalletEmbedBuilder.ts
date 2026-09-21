import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { Wallet } from '../../../domain/entities/Wallet.js';
import { generateAddressQrCode } from '../../../infrastructure/qrcode/QrCodeGenerator.js';

export async function buildDepositWalletEmbed(
  wallet: Wallet,
): Promise<{ embed: EmbedBuilder; files: AttachmentBuilder[] }> {
  const qrBuffer = await generateAddressQrCode(wallet.address);
  const attachment = new AttachmentBuilder(qrBuffer, { name: 'deposit-qr.png' });

  const embed = new EmbedBuilder()
    .setAuthor({ name: `Deposit · ${wallet.currency}` })
    .setTitle(`📥 Send ${wallet.currency} to this address`)
    .setDescription(`\`\`\`${wallet.address}\`\`\``)
    .setColor(0xf1c40f)
    .setImage('attachment://deposit-qr.png')
    .setFooter({ text: 'A brand-new wallet was generated for this deal and is never reused.' });

  if (wallet.currency === 'USDT') {
    embed.addFields({
      name: '⚠️ Also send a little POL (MATIC)',
      value:
        'USDT on Polygon needs POL to pay network gas, and this wallet has none of its own. ' +
        "Send a few cents' worth (e.g. **0.5 POL**) to the same address, or the payout cannot be sent later.",
    });
  }

  return { embed, files: [attachment] };
}
