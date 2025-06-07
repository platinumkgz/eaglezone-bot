import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import TelegramBot from 'node-telegram-bot-api';
import cors from 'cors';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, updateDoc, arrayUnion } from 'firebase/firestore';

const app = express();
app.use(express.json());
app.use(cors());

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEB_APP_URL = 'https://eaglezonegame.netlify.app';
const INVITE_BONUS = 500;
const FRIENDS_PER_REWARD = 10;
const REWARD_AMOUNT = 10000;

// Firebase configuration
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Handle /start command with referral
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  const referrerId = match[1]?.startsWith('ref_') ? match[1].split('ref_')[1] : null;

  console.log(`[DEBUG] /start received: userId=${userId}, referrerId=${referrerId}`);

  try {
    const userDocRef = doc(db, 'users', userId);
    const userDoc = await getDoc(userDocRef);

    // Get user profile photo
    let avatar = null;
    try {
      const photos = await bot.getUserProfilePhotos(msg.from.id, { limit: 1 });
      if (photos.total_count > 0) {
        const fileId = photos.photos[0][0].file_id;
        const file = await bot.getFile(fileId);
        avatar = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
        console.log(`[DEBUG] Avatar URL for ${userId}: ${avatar}`);
      } else {
        console.log(`[DEBUG] No profile photo for ${userId}, using fallback`);
        avatar = `https://api.dicebear.com/7.x/avatars/svg?seed=${userId}`;
      }
    } catch (error) {
      console.error(`[ERROR] Failed to get profile photo for ${userId}: ${error.message}`);
      avatar = `https://api.dicebear.com/7.x/avatars/svg?seed=${userId}`;
    }

    if (!userDoc.exists()) {
      // Create new user
      const newUser = {
        telegram_id: msg.from.id,
        username: msg.from.username ? `@${msg.from.username}` : null,
        displayName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || `Игрок ${userId}`,
        avatar: avatar,
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

      console.log(`[DEBUG] Creating new user: ${JSON.stringify(newUser)}`);
      await setDoc(userDocRef, newUser);

      // Update referrer's stats
      if (referrerId) {
        const referrerDocRef = doc(db, 'users', referrerId);
        const referrerDoc = await getDoc(referrerDocRef);

        if (referrerDoc.exists()) {
          const referrerData = referrerDoc.data();
          const newReferralCount = (referrerData.total_referrals || 0) + 1;
          const newReferralRewards = (referrerData.referral_rewards || 0) + INVITE_BONUS;
          const completedCycles = Math.floor(newReferralCount / FRIENDS_PER_REWARD);
          const additionalRewards = completedCycles * REWARD_AMOUNT;

          console.log(`[DEBUG] Updating referrer ${referrerId}: newReferralCount=${newReferralCount}`);
          await updateDoc(referrerDocRef, {
            total_referrals: newReferralCount,
            referral_rewards: newReferralRewards + additionalRewards,
            eagleTokens: Math.floor(Number(referrerData.eagle_tokens || 0) + INVITE_BONUS + additionalRewards),
            friends: arrayUnion(userId),
            updatedAt: new Date().toISOString(),
          });

          await bot.sendMessage(referrerId, `🎉 Новый друг (${newUser.displayName}) присоединился по вашей ссылке! Вы получили ${INVITE_BONUS} EAGLE!`);
          console.log(`[DEBUG] Sent notification to referrer ${referrerId}`);
        } else {
          console.log(`[DEBUG] Referrer ${referrerId} not found`);
        }
      }
    } else if (referrerId && !userDoc.data().referred_by) {
      // Update existing user with referrer
      console.log(`[DEBUG] Updating existing user ${userId} with referrerId=${referrerId}`);
      const userData = userDoc.data();
      const updatedAvatar = userData.avatar || avatar;
      await updateDoc(userDocRef, {
        referredBy: referrerId,
        avatar: updatedAvatar,
        updatedAt: new Date().toISOString(),
      });

      const referrerDocRef = doc(db, 'users', referrerId);
      const referrerDoc = await getDoc(referrerDocRef);

      if (referrerDoc.exists()) {
        const referrerData = referrerDoc.data();
        const newReferralCount = (referrerData.total_referrals || 0) + 1;
        const newReferralRewards = (referrerData.referral_rewards || 0) + INVITE_BONUS;
        const completedCycles = Math.floor(newReferralCount / FRIENDS_PER_REWARD);
        const additionalRewards = completedCycles * REWARD_AMOUNT;

        console.log(`[DEBUG] Updating referrer ${referrerId} for existing user: newReferralCount=${newReferralCount}`);
        await updateDoc(referrerDocRef, {
          total_referrals: newReferralCount,
          referral_rewards: newReferralRewards + additionalRewards,
          eagleTokens: Math.floor(Number(referrerData.eagle_tokens || 0) + INVITE_BONUS + additionalRewards),
          friends: arrayUnion(userId),
          updatedAt: new Date().toISOString(),
        });

        await bot.sendMessage(referrerId, `🎉 Друг (${userDoc.data().displayName}) добавил вас как реферера! Вы получили ${INVITE_BONUS} EAGLE!`);
        console.log(`[DEBUG] Sent notification to referrer ${referrerId}`);
      } else {
        console.log(`[DEBUG] Referrer ${referrerId} not found`);
      }
    } else {
      console.log(`[DEBUG] User ${userId} already exists and has referredBy: ${userDoc.data().referredBy}`);
      const userData = userDoc.data();
      if (!userData.avatar) {
        await updateDoc(userDocRef, {
          avatar: avatar,
          updatedAt: new Date().toISOString(),
        });
        console.log(`[DEBUG] Updated avatar for existing user ${userId}`);
      }
    }

    const referralLink = `https://t.me/eaglezone_bot?start=ref_${userId}`;
    console.log(`[DEBUG] Sending WebApp link: ${WEB_APP_URL}?ref=${userId}`);
    await bot.sendMessage(chatId, `🎮 Добро пожаловать в EagleZone! Запусти игру и приглашай друзей по своей ссылке: ${referralLink}`, {
      reply_markup: {
        inline_keyboard: [[{ text: '🚀 Играть', web_app: { url: `${WEB_APP_URL}?ref=${userId}` } }]],
      },
    });
  } catch (error) {
    console.error(`[ERROR] /start handler: ${error.message}`);
    await bot.sendMessage(chatId, '😔 Произошла ошибка. Попробуйте снова.');
  }
});

// Start server
app.listen(3000, () => console.log('🚀 Server running on port ${PORT}'));
