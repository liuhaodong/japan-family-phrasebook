// Japan Family Master Itinerary Data (Dec 5, 2026 – Jan 10, 2027)
window.TRIP_ITINERARY = {
  title: "日本家庭35晚长假全场景日语手册",
  subtitle: "2026年12月5日 – 2027年1月10日 · 成田 · 东京高轮 · 轻井泽滑雪 · 保育园周 & 银座纪念日 · 福冈博多 · 由布院龟之井别庄 · 东京浜松町跨年",
  family: [
    { name: "刘浩东 (Haodong Liu)", role: "爸爸 · Google SWE Manager", jpName: "劉 浩東（りゅう こうとう / リュウ）" },
    { name: "滕帅帅 (Sherry Teng)", role: "妈妈 · Software Engineer", jpName: "シェリー（滕 帥帥）" },
    { name: "Jinny (静怡)", role: "大女儿 · 6岁半 (未就学児 / 幼児)", jpName: "ジニー（6歳半・ろくさいはん）" },
    { name: "Jaycie", role: "小女儿 · 2岁半 (婴儿车 / 纸尿裤)", jpName: "ジェイシー（2歳半・にさいはん）" }
  ],
  legs: [
    {
      id: "all",
      shortTitle: "全部场景 (All 18)",
      dates: "12/5 – 1/10",
      icon: "🗾",
      modules: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]
    },
    {
      id: "leg1",
      shortTitle: "Leg 1 · 成田抵达",
      dates: "12/5 – 12/7",
      city: "成田 (Narita)",
      hotel: "Hotel Nikko Narita (ホテル日航成田)",
      icon: "✈️",
      summary: "ZIPAIR ZG025 19:55 抵达成田T1 → 1F 16号巴士站免费接驳车 → 日航成田酒店 (Conf #25050SH056067, One Harmony #302035054)",
      modules: [1, 2, 3, 4, 10, 12, 17, 18]
    },
    {
      id: "leg2",
      shortTitle: "Leg 2 · 东京高轮缓冲",
      dates: "12/7 – 12/9",
      city: "东京高轮 (Shinagawa / Takanawa)",
      hotel: "The Prince Sakura Tower Tokyo (ザ・プリンス さくらタワー東京)",
      icon: "🗼",
      summary: "N'EX 成田特快直达品川站 → 樱花塔王子酒店 → 12/9 退房时将2个大行李箱转存至隔壁「新高轮格兰王子大饭店」寄存至12/12",
      modules: [1, 2, 3, 4, 8, 10, 15, 16, 17, 18]
    },
    {
      id: "leg3",
      shortTitle: "Leg 3 · 轻井泽滑雪",
      dates: "12/9 – 12/12",
      city: "轻井泽 (Karuizawa)",
      hotel: "Karuizawa Prince Hotel East (軽井沢プリンスホテル イースト)",
      icon: "⛷️",
      summary: "北陆新干线轻装往返 → 轻井泽王子东馆 → 双板租赁、Jinny 儿童滑雪私教/团课、Jaycie 玩雪乐园、轻井泽奥特莱斯",
      modules: [1, 2, 3, 4, 5, 8, 10, 12, 17, 18]
    },
    {
      id: "leg4",
      shortTitle: "Leg 4 · 保育园 & 银座纪念日",
      dates: "12/12 – 12/19",
      city: "东京高轮 & 银座 (Takanawa & Ginza)",
      hotel: "Grand Prince Hotel Shin Takanawa (グランドプリンスホテル新高輪)",
      icon: "🍣",
      summary: "Jinny & Jaycie 就读 Maho no Hoikuen 保育园 · 浩东 & Sherry 结婚7周年银座5场板前/个室午餐 (12/14–12/18)",
      modules: [1, 2, 4, 6, 7, 8, 10, 12, 15, 16, 17, 18]
    },
    {
      id: "leg5",
      shortTitle: "Leg 5 · 福冈 & 由布院温泉",
      dates: "12/19 – 12/27",
      city: "福冈博多 & 由布院 (Fukuoka & Yufuin)",
      hotel: "Grand Hyatt Fukuoka (グランドハイアット福岡) & 亀の井別荘 (Kamenoi Bessou)",
      icon: "♨️",
      summary: "12/19–21 福冈君悦 → 12/21 寄存大行李去由布院「龟之井别庄」住1晚 → 12/22–27 回福冈君悦连住5晚 (圣诞周、熊本/门司港一日游)",
      modules: [1, 2, 3, 4, 8, 9, 10, 12, 13, 15, 16, 17, 18]
    },
    {
      id: "leg6",
      shortTitle: "Leg 6 · 东京浜松町跨年",
      dates: "12/27 – 1/10",
      city: "东京浜松町 / 大门 (Hamamatsucho / Daimon)",
      hotel: "Airbnb 001｜浜松町・大門 (近东京塔 & 增上寺)",
      icon: "⛩️",
      summary: "羽田单轨电车直达浜松町 → 14晚公寓生活 → 增上寺/东京塔跨年与新年初诣参拜 → 1/10 晚 ZIPAIR ZG026 (21:25) 返程旧金山",
      modules: [1, 2, 3, 8, 10, 11, 12, 14, 15, 16, 17, 18]
    }
  ],
  accommodations: [
    {
      dates: "12/6 – 12/7 (1晚)",
      name: "Hotel Nikko Narita",
      jpName: "ホテル日航成田",
      address: "〒286-0106 千葉県成田市取香500",
      note: "Conf #25050SH056067 · One Harmony #302035054 · 成田T1 1F 16号巴士站免费接驳",
      taxiDriverText: "運転手さん、こちらの「ホテル日航成田」（成田市取香500）までお願いします。"
    },
    {
      dates: "12/7 – 12/9 (2晚)",
      name: "The Prince Sakura Tower Tokyo",
      jpName: "ザ・プリンス さくらタワー東京",
      address: "〒108-8612 東京都港区高輪 3-13-1",
      note: "品川站高轮口步行3分钟 · 12/9 退房时把大箱子转去隔壁新高轮格兰王子",
      taxiDriverText: "運転手さん、品川駅高輪口の「ザ・プリンス さくらタワー東京」（港区高輪3-13-1）の正面玄関までお願いします。"
    },
    {
      dates: "12/9 – 12/12 (3晚)",
      name: "Karuizawa Prince Hotel East",
      jpName: "軽井沢プリンスホテル イースト",
      address: "〒389-0193 長野県北佐久郡軽井沢町大字軽井沢 1016-75",
      note: "轻井泽站南口接驳车/出租车 · 紧邻滑雪场与森林温泉",
      taxiDriverText: "運転手さん、「軽井沢プリンスホテル イースト」（イースト館のロビー）までお願いします。"
    },
    {
      dates: "12/12 – 12/19 (7晚)",
      name: "Grand Prince Hotel Shin Takanawa",
      jpName: "グランドプリンスホテル新高輪",
      address: "〒108-8612 東京都港区高輪 3-13-1",
      note: "保育园周驻地 · 入住时领取 12/9 从樱花塔转存过来的2个大行李箱",
      taxiDriverText: "運転手さん、品川の「グランドプリンスホテル新高輪」（港区高輪3-13-1）の正面玄関までお願いします。"
    },
    {
      dates: "12/19 – 12/21 & 12/22 – 12/27 (2晚+5晚)",
      name: "Grand Hyatt Fukuoka",
      jpName: "グランドハイアット福岡",
      address: "〒812-0018 福岡県福岡市博多区住吉 1-2-82（キャナルシティ博多）",
      note: "与博多运河城相连 · 12/21 退房时将大行李寄存至 12/22 回来连住5晚",
      taxiDriverText: "運転手さん、キャナルシティ博多の「グランドハイアット福岡」（博多区住吉1-2-82）の正面玄関までお願いします。"
    },
    {
      dates: "12/21 – 12/22 (1晚)",
      name: "Yufuin Kamenoi Bessou",
      jpName: "由布院 玉の湯・亀の井別荘（かめのいべっそう）",
      address: "〒879-5102 大分県由布市湯布院町川上 2633-1",
      note: "由布院顶级御三家温泉旅馆 · 紧邻金鳞湖与键屋",
      taxiDriverText: "運転手さん、金鱗湖の近くの「亀の井別荘」（湯布院町川上2633-1）までお願いします。"
    },
    {
      dates: "12/27 – 1/10 (14晚)",
      name: "Airbnb Hamamatsucho / Daimon",
      jpName: "浜松町・大門 Airbnb（港区浜松町2丁目）",
      address: "〒105-0013 東京都港区浜松町2丁目（浜松町駅・大門駅 徒歩3分）",
      note: "近东京塔 & 增上寺 · 羽田单轨直达浜松町 / 浅草线大门站直达成田",
      taxiDriverText: "運転手さん、JR浜松町駅の近くの「港区浜松町2丁目」のこちらの住所までお願いします。"
    }
  ],
  ginzaLunches: [
    {
      date: "12/14 (周一) 11:00",
      name: "Sushi Ginza Onodera (鮨 銀座おのでら 総本店)",
      address: "東京都中央区銀座 5-14-14 サンリット銀座ビル III 2F",
      course: "Tsuki Course (月コース) · カウンター席 2名 · ¥24,200",
      resCode: "待确认绑定信用卡 (Planned 11:00)",
      highlight: "正统江户前寿司板前 · 东银座站步行2分钟"
    },
    {
      date: "12/15 (周二) 11:30",
      name: "Ginza Yokota (銀座 よこ田)",
      address: "東京都中央区銀座 5-5-11 塚本不動産ビル 5F-B",
      course: "天婦羅と寿司 昼コース (16品) · 2名 · ¥15,180 (含税服)",
      resCode: "Tabelog #TD6NPNPJZH",
      highlight: "米其林星级传承天妇罗与寿司双享"
    },
    {
      date: "12/16 (周三) 12:00",
      name: "Ginza Yamashina (銀座 山科)",
      address: "東京都中央区銀座 6-4-3 GICROS GINZA GEMS 7F",
      course: "完全個室 · 早割レアカツシャトーブリアンコース (13品) · ¥33,000 + 每人必点1杯饮品",
      resCode: "Tabelog #899X3CQLAL",
      highlight: "完全包厢 · 名物夏多布里昂炸牛排（含生肉料理，可请主厨炙烤/做熟）"
    },
    {
      date: "12/17 (周四) 12:00",
      name: "Akita Gyu Teppan Yaki Ginza Gomei (秋田牛鉄板焼 銀座 五明)",
      address: "東京都中央区銀座 6-4-18 マキシ・ド・ピアビル B1F",
      course: "カウンター禁煙 · 【ランチ】ステーキコース · 2名 · ¥43,560 (含税服)",
      resCode: "Tabelog #JSZXLQDDQV",
      highlight: "A5秋田牛铁板烧板前 · 推荐 Medium Rare (ミディアムレア)"
    },
    {
      date: "12/18 (周五) 12:00",
      name: "Kappou Ukai (銀座 kappou ukai)",
      address: "東京都中央区銀座 8-9-15 JEWEL BOX GINZA B1F",
      course: "カウンター禁煙 · おまかせランチコース · 2名 · ¥30,360 (含15%服务费)",
      resCode: "Tabelog #E3YXY4QXVN",
      highlight: "Ukai集团顶级割烹板前 · 7周年纪念日收官午餐"
    }
  ]
};
