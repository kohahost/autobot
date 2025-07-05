const StellarSdk = require('stellar-sdk');
const ed25519 = require('ed25519-hd-key');
const bip39 = require('bip39');
const axios = require('axios');
require("dotenv").config();

const {
  MNEMONIC,
  RECEIVER_ADDRESS,
  TELEGRAM_TOKEN,
  TELEGRAM_CHAT_ID
} = process.env;

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
const NETWORK = 'Pi Network';

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendTelegram(text) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown"
    });
  } catch {
    console.warn("⚠️ Gagal kirim Telegram");
  }
}

async function getKeypairFromMnemonic(mnemonic) {
  if (!bip39.validateMnemonic(mnemonic)) {
    await sendTelegram("❌ Mnemonic tidak valid. Bot dihentikan.");
    process.exit(1);
  }
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
  return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

async function getAvailableBalance(address) {
  const res = await axios.get(`https://api.mainnet.minepi.com/accounts/${address}`);
  const native = res.data.balances.find(b => b.asset_type === "native");
  return parseFloat(native?.balance || "0");
}

async function sendIfEnough(senderKeypair) {
  const senderPublic = senderKeypair.publicKey();
  const baseFee = await server.fetchBaseFee();
  const account = await server.loadAccount(senderPublic);

  const balance = await getAvailableBalance(senderPublic);
  const reserve = 1.0;
  const txFee = (baseFee * 2) / 1e7;
  const amountToSend = balance - reserve - txFee;

  if (amountToSend <= 0) {
    console.log("⏳ Saldo belum cukup. Menunggu...");
    return false;
  }

  const formatted = amountToSend.toFixed(7);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: (baseFee * 2).toString(),
    networkPassphrase: NETWORK,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: RECEIVER_ADDRESS,
      asset: StellarSdk.Asset.native(),
      amount: formatted
    }))
    .setTimeout(30)
    .build();

  tx.sign(senderKeypair);

  try {
    const result = await server.submitTransaction(tx);
    const explorer = `https://api.mainnet.minepi.com/transactions/${result.hash}`;

    console.log(`✅ Transfer berhasil: ${formatted} Pi`);
    await sendTelegram(`
✅ Sukses Kirim Pi ZendsDev
📤 Jumlah: ${formatted} Pi
📮 Dari: ${senderPublic}
📥 Ke: ${RECEIVER_ADDRESS}
🔗 Tx: ${explorer}
    `.trim());
    return true;
  } catch (e) {
    console.error("❌ Gagal transfer:", e.response?.data?.extras?.result_codes || e.message);
    return false;
  }
}

async function loopUntilSuccess() {
  const senderKeypair = await getKeypairFromMnemonic(MNEMONIC);

  while (true) {
    try {
      const sent = await sendIfEnough(senderKeypair);
      if (sent) break; // Keluar jika sukses kirim
    } catch (err) {
      console.error("❌ Error:", err.message || err);
    }

    await delay(5); // 0.1 ms
  }
}

loopUntilSuccess();
