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
    console.warn("⚠️ Gagal kirim ke Telegram");
  }
}

async function getKeypairFromMnemonic(mnemonic) {
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const { key } = ed25519.derivePath("m/44'/314159'/0'", seed.toString('hex'));
  return StellarSdk.Keypair.fromRawEd25519Seed(key);
}

async function getAvailableBalance(address) {
  try {
    const res = await axios.get(`https://api.mainnet.minepi.com/accounts/${address}`);
    const native = res.data.balances.find(b => b.asset_type === "native");
    return parseFloat(native?.balance || "0");
  } catch (e) {
    if (e.response?.status === 429) {
      console.error("🛑 Kena rate limit (429). Bot akan restart...");
      await sendTelegram("🛑 Bot kena rate limit (429). Restart otomatis...");
      process.exit(1); // Paksa keluar
    }
    throw e;
  }
}

async function sendPi(senderKeypair) {
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
✅ Sukses Kirim Pi
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

async function loop() {
  const senderKeypair = await getKeypairFromMnemonic(MNEMONIC);
  const senderPublic = senderKeypair.publicKey();

  console.log("🔄 Memantau saldo setiap 1 detik...");

  while (true) {
    try {
      const balance = await getAvailableBalance(senderPublic);
      console.log(`💰 Saldo tersedia: ${balance} Pi`);

      if (balance > 1.001) {
        const sent = await sendPi(senderKeypair);
        if (sent) break;
      }
    } catch (err) {
      console.error("❌ Error:", err.message || err);
    }

    await delay(100); // jaga jarak polling agar tidak rate limit
  }
}

loop();
