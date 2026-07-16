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
    .setDescription(`\`\`\`${wallet.address}\`\`\``)
    .setColor(0xf1c40f)
    .setImage('attachment://deposit-qr.png')
    .setFooter({ text: 'A brand-new wallet was generated for this deal and will never be reused.' });

  return { embed, files: [attachment] };
}
