import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = 'https://eaglezonegame.netlify.app';

const INVITE_BONUS = 500;
const FRIENDS_PER_REWARD = 10;
const REWARD_AMOUNT = 10000;

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const referrerId = match[1] || null;

  console.log(`[DEBUG] Start: userId=${userId}, ref=${referrerId}`);

  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    let avatar = `https://api.dicebear.com/7.x/identicon/svg?seed=${userId}`;
    try {
      const photos = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photos.total_count > 0) {
        const fileId = photos.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        avatar = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
      }
    } catch (err) {
      console.warn(`[Avatar] Using fallback for user ${userId}`);
    }

    const isNewUser = !userSnap.exists();

    if (isNewUser) {
      const newUser = {
        telegram_id: msg.from.id,
        username: msg.from.username ? `@${msg.from.username}` : null,
        displayName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || `Игрок ${userId}`,
        avatar,
        eagleTokens: 0,
        clickPower: 1,
        energy: 500,
        maxEnergy: 500,
        lastClickTime: new Date().toISOString(),
        totalReferrals: 0,
        referralRewards: 0,
        referredBy: referrerId || null,
        friends: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await setDoc(userRef, newUser);
      console.log(`[DEBUG] Created new user ${userId}`);

      // Update referrer
      if (referrerId) {
        const refRef = doc(db, 'users', referrerId);
        const refSnap = await getDoc(refRef);
        if (refSnap.exists()) {
          const refData = refSnap.data();
          const newReferralCount = (refData.total_referrals || 0) + 1;
          const newRewards = (refData.referral_rewards || 0) + INVITE_BONUS;
          const completedCycles = Math.floor(newReferralCount / FRIENDS_PER_REWARD);
          const bonus = completedCycles * REWARD_AMOUNT;

          await updateDoc(refRef, {
            total_referrals: newReferralCount,
            referral_rewards: newRewards + bonus,
            eagleTokens: Math.floor(Number(refData.eagle_tokens || 0) + INVITE_BONUS + bonus),
            friends: arrayUnion(userId),
            updatedAt: new Date().toISOString(),
          });

          await bot.sendMessage(
            referrerId,
            `🎉 Новый друг (${newUser.displayName}) присоединился по вашему коду!\nВы получили +${INVITE_BONUS} EAGLE!`
          );
        }
      }
    }

    const referralCode = userId;

    const introText = `🔥 Это *EagleZone* — кликер нового уровня.

💸 Тут можно реально получить $EAGLE, но вход только по коду.

🚀 У тебя есть код? Тогда вперед:`;

    await bot.sendMessage(chatId, introText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Запустить игру', web_app: { url: WEB_APP_URL } }],
        ],
      },
    });
  } catch (err) {
    console.error(`[ERROR] /start failed: ${err.message}`);
    await bot.sendMessage(chatId, '⚠️ Что-то пошло не так. Попробуйте ещё раз позже.');
  }
});

app.get('/', (_, res) => {
  res.send('✅ EagleZone Bot is awake!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
