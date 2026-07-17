import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import type { Wallet } from '../../../domain/entities/Wallet.js';
import { generateAddressQrCode } from '../../../infrastructure/qrcode/QrCodeGenerator.js';

export async function buildDepositWalletEmbed(
  wallet: Wallet,
): Promise<{ embed: EmbedBuilder; files: AttachmentBuilder[] }> {
  const qrBuffer = await generateAddressQrCode(wallet.address);
  const attachment = new AttachmentBuilder(qrBuffer, { name: 'deposit-qr.png' });

  const embed = new EmbedBuilder()
    .setTitle(`Send ${wallet.currency} to this address`)
    .setDescription(
      wallet.currency === 'USDT'
        ? `\`\`\`${wallet.address}\`\`\`\n⚠️ **Also send a small amount of POL (MATIC)** to this same address — USDT transfers on Polygon need POL to pay network gas, and this wallet has none of its own. Without it, the payout cannot be sent later. A few cents' worth (e.g. 0.5 POL) is more than enough.`
        : `\`\`\`${wallet.address}\`\`\``,
    )
    .setColor(0xf1c40f)
    .setImage('attachment://deposit-qr.png')
    .setFooter({ text: 'A brand-new wallet was generated for this deal and will never be reused.' });

  return { embed, files: [attachment] };
}
