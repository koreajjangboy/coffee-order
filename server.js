require('dotenv').config();
const express = require('express');
const path = require('path');
const useragent = require('express-useragent');
const axios = require('axios');
const { WebClient } = require('@slack/web-api');

const app = express();
const PORT = process.env.PORT || 3000;

// Slack WebClient 초기화 (Bot Token 사용)
const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);

app.use(express.json());
app.use(useragent.express());

// Slack 연결 전 또는 실패 시 사용할 기본 캐시 메뉴
let cachedMenuList = [
  { code: "M01", name: "아이스아메리카노" },
  { code: "M02", name: "아이스라떼" }
];

// -------------------------------------------------------------
// 📌 Slack 채널의 '고정 메시지(Pins)'에서 공지 메뉴 JSON 직접 로드
// -------------------------------------------------------------
async function fetchMenuFromSlackPinnedMessage() {
  try {
    const channelId = process.env.SLACK_CHANNEL_ID;

    if (!process.env.SLACK_BOT_TOKEN || !channelId) {
      console.warn('⚠️ SLACK_BOT_TOKEN 또는 SLACK_CHANNEL_ID가 설정되지 않았습니다.');
      return cachedMenuList;
    }

    // 1. 해당 채널의 고정된 메시지 목록(Pins) 가져오기
    const pinsResult = await slackClient.pins.list({ channel: channelId });

    if (!pinsResult.items || pinsResult.items.length === 0) {
      console.warn('⚠️ 채널에 고정된 메시지가 없습니다.');
      return cachedMenuList;
    }

    // 2. 고정 메시지 중 JSON 메뉴 형식([{"code": ...}])이 포함된 글 찾기
    const pinnedMsgItem = pinsResult.items.find(item => {
      const text = item.message?.text;
      return text && (text.includes('"code"') || text.includes('code'));
    });

    if (!pinnedMsgItem) {
      console.warn('⚠️ 고정 메시지 중 메뉴 JSON 데이터를 찾지 못했습니다.');
      return cachedMenuList;
    }

    // 3. 메시지 본문에서 JSON 배열([ ... ]) 부분만 추출하여 파싱
    const messageText = pinnedMsgItem.message.text;
    const jsonMatch = messageText.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const parsedMenus = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsedMenus) && parsedMenus.length > 0) {
        cachedMenuList = parsedMenus;
        console.log('📌 Slack 채널 고정글에서 메뉴 로드 성공:', cachedMenuList);
      }
    }

    return cachedMenuList;
  } catch (err) {
    console.error('❌ Slack 고정글 읽기 에러:', err.message);
    return cachedMenuList;
  }
}

// -------------------------------------------------------------
// 모바일 접속 검증 미들웨어
// -------------------------------------------------------------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/health') || req.path.startsWith('/api/menu')) {
    return next();
  }

  const ua = req.useragent;
  if (!ua.isMobile && !ua.isTablet) {
    return res.status(403).send('📱 모바일 전용 페이지입니다');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// 1. 메뉴 동적 조회 API (접속 시 Slack 고정글 조회)
app.get('/api/menu', async (req, res) => {
  const menus = await fetchMenuFromSlackPinnedMessage();
  res.json({ success: true, menus });
});

// 2. 주문 전송 API
app.post('/api/order', async (req, res) => {
  try {
    const { name, menuCode } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: '이름을 입력해주세요.' });
    }

    const selectedMenu = cachedMenuList.find(m => m.code === menuCode);
    const menuName = selectedMenu ? selectedMenu.name : menuCode;

    const now = new Date();
    const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const slackMessage = `${name.trim()} | ${menuCode} | ${menuName} | ${timeString}`;

    // Incoming Webhook을 통해 Slack 채널로 주문 메시지 발송
    await axios.post(process.env.SLACK_WEBHOOK_URL, { text: slackMessage });

    return res.json({
      success: true,
      data: { name: name.trim(), menuCode, menuName, time: timeString }
    });
  } catch (error) {
    console.error('주문 발송 실패:', error.message);
    return res.status(500).json({ success: false, error: '주문 발송 실패' });
  }
});

app.listen(PORT, () => {
  console.log(`☕ 서버 실행 중: http://localhost:${PORT}`);
});