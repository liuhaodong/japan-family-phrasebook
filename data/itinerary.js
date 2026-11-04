// Japan Family Master Itinerary Data (Dec 5, 2026 – Jan 10, 2027)
// Complete structured data from Google Doc Tab 1 (Master Itinerary) + Tab 2 (Phrasebook)
window.TRIP_ITINERARY = {
  title: "日本家庭35晚长假全场景行程与日语手册",
  subtitle: "2026年12月5日 – 2027年1月10日 · 成田 · 东京高轮 · 轻井泽滑雪 · 保育园周 & 银座纪念日 · 福冈博多 · 由布院龟之井别庄 · 东京浜松町跨年",
  family: [
    { name: "刘浩东 (Haodong Liu)", role: "爸爸 · Google SWE Manager", jpName: "劉 浩東（りゅう こうとう / リュウ）" },
    { name: "滕帅帅 (Sherry Teng)", role: "妈妈 · Software Engineer", jpName: "シェリー（滕 帥帥）" },
    { name: "Jinny (静怡)", role: "大女儿 · 6岁半 (未就学児 / 小学生料金需确认)", jpName: "ジニー（6歳半・ろくさいはん）" },
    { name: "Jaycie", role: "小女儿 · 2岁半 (婴儿车 / 纸尿裤 / 6岁以下免费)", jpName: "ジェイシー（2歳半・にさいはん）" }
  ],

  // International Flights (ZIPAIR SFO <-> NRT)
  flights: [
    {
      direction: "去程 Outbound",
      date: "2026-12-05 (周六) → 12-06 (周日)",
      airline: "ZIPAIR Tokyo",
      flightNo: "ZG025",
      confCode: "CYBNOT",
      depAirport: "SFO (旧金山国际机场)",
      depTime: "15:35 PST (12/5)",
      arrAirport: "NRT T1 (东京成田第一航站楼)",
      arrTime: "19:55 JST (12/6)",
      seats: "18C, 19E, 19G",
      baggage: "2件托运行李 × 30 kg (Checked Bags: 2× 30 kg)",
      note: "抵达 NRT T1 后，若需寄送雪具/大件行李，1F 到达大厅 Yamato 黑猫宅急便 & JAL ABC 柜台营业至 22:30；随后前往 1F 16号巴士站搭乘日航成田免费接驳车。"
    },
    {
      direction: "返程 Inbound",
      date: "2027-01-10 (周日)",
      airline: "ZIPAIR Tokyo",
      flightNo: "ZG026",
      confCode: "CYBNOT",
      depAirport: "NRT T1 (东京成田第一航站楼)",
      depTime: "21:25 JST (1/10)",
      arrAirport: "SFO (旧金山国际机场)",
      arrTime: "13:45 PST (1/10 同日抵达)",
      seats: "19G, 18J, 18H",
      baggage: "2件托运行李 × 30 kg (Checked Bags: 2× 30 kg)",
      note: "1/10 白天可在东京享受完整最后一天，16:30–17:00 左右从大门站（都营浅草线/京成Sky Access直达）或品川/东京站（JR N'EX）前往成田 T1。"
    }
  ],

  // 3 Smart Luggage Hacks across the 35 nights
  luggageHacks: [
    {
      date: "12/6 (周日) 晚 19:55 – 22:30",
      title: "锦囊 1 · 成田 T1 机场黑猫宅急便 (可选)",
      route: "成田 T1 1F 到达大厅 → 后续酒店",
      icon: "📦",
      detail: "成田 T1 1F 到达大厅的 Yamato (黑猫宅急便) 与 JAL ABC 柜台营业至 22:30。如果有暂时不用的大件衣物或装备，可在出关后直接寄往后续酒店。",
      phraseModuleId: 15
    },
    {
      date: "12/9 (周三) 退房时",
      title: "锦囊 2 · 高轮王子酒店群「同园跨楼寄存」神操作",
      route: "樱花塔王子酒店 (退房) ➔ 新高轮格兰王子大饭店 (寄存至12/12)",
      icon: "🧳",
      detail: "The Prince Sakura Tower 与 Grand Prince Hotel Shin Takanawa 共享同一个高轮日本庭园！12/9 退房去轻井泽前，请樱花塔礼宾部将大行李箱直接转存至隔壁「新高轮格兰王子」保管至 12/12 入住，全家仅背 3 天轻便包坐北陆新干线去轻井泽滑雪！",
      phraseModuleId: 3
    },
    {
      date: "12/21 (周一) 退房时",
      title: "锦囊 3 · 福冈君悦寄存大箱 ➔ 轻装去由布院温泉",
      route: "福冈君悦酒店 (寄存1晚) ➔ 由布院龟之井别庄 ➔ 12/22 回福冈君悦",
      icon: "♨️",
      detail: "在福冈君悦分为两段入住 (12/19–21 及 12/22–27)。12/21 前往由布院「龟之井别庄」时，将所有大行李箱留在福冈君悦礼宾部寄存，仅带 1 晚过夜包去泡温泉！",
      phraseModuleId: 3
    }
  ],

  // 6 Major Trip Legs with full schedule, timeline items, and coordinates
  legs: [
    {
      id: "all",
      shortTitle: "全部行程 (All 35晚)",
      dates: "12/5 – 1/10",
      icon: "🗾",
      modules: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
      mapCenter: [35.2, 136.0],
      mapZoom: 5
    },
    {
      id: "leg1",
      shortTitle: "Leg 1 · 成田抵达",
      dates: "12/5 – 12/7 (1晚)",
      nights: 1,
      city: "千叶成田 (Narita)",
      hotel: "Hotel Nikko Narita (ホテル日航成田)",
      hotelConf: "Conf #25050SH056067 · One Harmony #302035054",
      roomType: "Comfort Triple Non-Smoking (本馆 · 3张140×200cm双人床) · ¥19,170 (含税)",
      icon: "✈️",
      color: "#2563eb",
      summary: "ZIPAIR ZG025 19:55 抵达成田T1 → 1F 16号巴士站免费接驳车 → 日航成田酒店休整缓冲",
      mapCenter: [35.774, 140.383],
      mapZoom: 13,
      modules: [1, 2, 3, 4, 10, 12, 17, 18],
      schedule: [
        {
          time: "12/5 15:35 → 12/6 19:55",
          tag: "✈️ 国际航班",
          title: "ZIPAIR ZG025 (SFO → NRT T1)",
          desc: "预约号 #CYBNOT · 座位 18C, 19E, 19G · 托运行李 2×30kg。19:55 降落成田第一航站楼 (Terminal 1)。"
        },
        {
          time: "12/6 20:20 – 22:40",
          tag: "🚌 免费接驳巴士",
          title: "成田 T1 1F 16号巴士站 (Bus Stop #16) → 日航成田酒店",
          desc: "晚间班次每20分钟一班：20:20, 20:40, 21:00, 21:20, 21:40, 22:00, 22:20, 22:40（车程约 5–10 分钟直达酒店大堂）。"
        },
        {
          time: "12/6 21:00 – 23:00",
          tag: "🍜 深夜晚餐 & 补给",
          title: "1F Serena 餐厅 或 本馆 1F 24小时 Lawson 便利店",
          desc: "• Casual Resort Dining Serena (1F)：自助晚餐至 22:00 (L.O. 21:30)；单点热食与客房送餐至 23:00 (L.O. 22:30)。\n• 24小时 Lawson (本馆1F大厅内)：热炸鸡块(からあげクン)、肉包、乌冬/拉面、饭团、三明治、鲜奶、酸奶、切块水果一应俱全。"
        },
        {
          time: "12/7 05:30 – 10:00",
          tag: "🥐 周一早餐优惠",
          title: "Serena 1F 早餐 (出示 One Harmony 会员卡享折扣)",
          desc: "Walk-in One Harmony 会员价：成人 ¥2,700/人，小学生 (6–12岁) ¥1,350，学龄前儿童 (6岁以下) 免费！"
        }
      ]
    },
    {
      id: "leg2",
      shortTitle: "Leg 2 · 东京高轮缓冲",
      dates: "12/7 – 12/9 (2晚)",
      nights: 2,
      city: "东京品川 / 高轮 (Shinagawa / Takanawa)",
      hotel: "The Prince Sakura Tower Tokyo (ザ・プリンス さくらタワー東京)",
      hotelConf: "Autograph Collection · Check-in 15:00 / Check-out 12:00",
      roomType: "港区高轮 3-13-1 · 品川站高轮口步行3分钟",
      icon: "🗼",
      color: "#4f46e5",
      summary: "N'EX 成田特快直达品川站 → 樱花塔王子酒店调时差 → 12/9 退房将大箱转存至隔壁新高轮格兰王子",
      mapCenter: [35.6272, 139.7368],
      mapZoom: 15,
      modules: [1, 2, 3, 4, 8, 10, 15, 16, 17, 18],
      schedule: [
        {
          time: "12/7 上午",
          tag: "🚆 机场进城直达",
          title: "日航成田免费巴士 → 成田 T1 → JR 成田特快 (N'EX) 直达品川站",
          desc: "乘10分钟接驳车回成田 T1，换乘 JR Narita Express (全车指定席，约70分钟) 直达品川站 (Shinagawa)。从高轮口 (Takanawa Exit) 过马路步行3分钟即达樱花塔王子酒店。"
        },
        {
          time: "12/7 – 12/8",
          tag: "🌸 庭园散步 & 倒时差",
          title: "高轮日本庭园慢节奏适应 & 东京亲子休闲",
          desc: "在高轮王子酒店群的传统日本庭园散步看锦鲤，轻松适应日本时差，采购小朋友防寒与滑雪贴身衣物。"
        },
        {
          time: "12/9 11:30 退房",
          tag: "🧳 关键行李操作",
          title: "礼宾部跨楼转存大行李箱 → 新高轮格兰王子大饭店",
          desc: "因为樱花塔与新高轮格兰王子共享同一片高轮日本庭园，退房时请礼宾部将沉重的大行李箱直接转交并寄存在「Grand Prince Hotel Shin Takanawa」至 12/12 入住！"
        }
      ]
    },
    {
      id: "leg3",
      shortTitle: "Leg 3 · 轻井泽滑雪",
      dates: "12/9 – 12/12 (3晚)",
      nights: 3,
      city: "长野轻井泽 (Karuizawa)",
      hotel: "Karuizawa Prince Hotel East (軽井沢プリンスホテル イースト)",
      hotelConf: "滑进滑出度假村 · 紧邻森林温泉与奥特莱斯",
      roomType: "长野县北佐久郡轻井泽町 1016-75",
      icon: "⛷️",
      color: "#0284c7",
      summary: "北陆新干线轻装65分钟直达 → 轻井泽王子东馆 → Jinny 滑雪课、Jaycie 玩雪乐园、森林温泉与奥莱",
      mapCenter: [36.341, 138.638],
      mapZoom: 14,
      modules: [1, 2, 3, 4, 5, 8, 10, 12, 17, 18],
      schedule: [
        {
          time: "12/9 中午",
          tag: "🚄 北陆新干线",
          title: "东京站 / 品川 → 轻井泽站 (约 65–75 分钟)",
          desc: "只背 3 天轻便行李，搭乘 JR 北陆新干线 (Hokuriku Shinkansen) 前往轻井泽站。从南口搭乘酒店接驳车或出租车前往 East 东馆。"
        },
        {
          time: "12/9 – 12/11",
          tag: "⛷️ 家庭滑雪 & 玩雪",
          title: "轻井泽王子大饭店滑雪场 (Karuizawa Prince Hotel Ski Resort)",
          desc: "• Jinny (6岁半)：参加儿童双板滑雪课 (Kids Ski Lesson) 及初级雪道练习。\n• Jaycie (2岁半)：在 Snow Park 玩雪乐园滑雪盆 (Sledding)、堆雪人。\n• 傍晚：东馆专属 Forest Hot Spring (森林温泉) 泡汤解乏，步行逛轻井泽王子购物广场 (Outlet)。"
        },
        {
          time: "12/12 下午",
          tag: "🚄 返回东京品川",
          title: "轻井泽站 → 东京站 → 品川高轮",
          desc: "乘北陆新干线返回东京，入住「新高轮格兰王子大饭店」，在前台/礼宾部直接领取 12/9 寄存的大行李箱。"
        }
      ]
    },
    {
      id: "leg4",
      shortTitle: "Leg 4 · 保育园 & 银座纪念日",
      dates: "12/12 – 12/19 (7晚)",
      nights: 7,
      city: "东京高轮 & 银座 (Takanawa & Ginza)",
      hotel: "Grand Prince Hotel Shin Takanawa (グランドプリンスホテル新高輪)",
      hotelConf: "连住7晚 · 领取 12/9 转存的大行李箱",
      roomType: "港区高轮 3-13-1 · 保育园周驻地",
      icon: "🍣",
      color: "#db2777",
      summary: "Jinny & Jaycie 体验东京「Maho no Hoikuen」保育园 · 浩东 & Sherry 庆祝结婚7周年银座5场顶级午餐 (12/14–12/18)",
      mapCenter: [35.669, 139.764],
      mapZoom: 15,
      modules: [1, 2, 4, 6, 7, 8, 10, 12, 15, 16, 17, 18],
      schedule: [
        {
          time: "12/14 (周一) – 12/18 (周五) 白天",
          tag: "👧👶 姐妹保育园体验",
          title: "Jinny & Jaycie 就读「魔法の保育園 (Maho no Hoikuen)」",
          desc: "每天早上送姐妹俩去保育园和日本小朋友一起玩耍、午睡、做手工；下午接园后全家在东京散步晚餐。"
        },
        {
          time: "12/14 (周一) 11:00",
          tag: "🥂 7周年午餐 Day 1 (⚠️待绑卡)",
          title: "鮨 銀座おのでら 総本店 (Sushi Ginza Onodera)",
          desc: "【状态：待绑定信用卡确认】月コース (Tsuki Course) · 吧台2名 · ¥12,100/人 (2人共 ¥24,200) · 银座 5-14-14 サンリット銀座ビル III 2F。"
        },
        {
          time: "12/15 (周二) 11:30",
          tag: "🥂 7周年午餐 Day 2 (✅已预约)",
          title: "銀座 よこ田 (Ginza Yokota) · Tabelog #TD6NPNPJZH",
          desc: "天婦羅と寿司 昼コース (16品 · 90分钟) · 2名 · ¥7,590/人 (2人含税服共 ¥15,180) · 当店付款 · 银座 5-5-11 塚本不動産ビル 5F-B。"
        },
        {
          time: "12/16 (周三) 12:00",
          tag: "🥂 7周年午餐 Day 3 (✅已预约)",
          title: "銀座 山科 (Ginza Yamashina) · Tabelog #899X3CQLAL",
          desc: "完全個室(包厢) · 早割レアカツシャトーブリアンコース (13品 · 2小时) · 2人含税服共 ¥33,000 + 每人必点1杯饮品 (1 drink order required)。💡含生肉料理，入座时可请主厨帮 Sherry 炙烤/做熟。"
        },
        {
          time: "12/17 (周四) 12:00",
          tag: "🥂 7周年午餐 Day 4 (✅已预约)",
          title: "秋田牛鉄板焼 銀座 五明 (Ginza Gomei) · Tabelog #JSZXLQDDQV",
          desc: "吧台禁烟 · 【ランチ】ステーキコース (2小时) · 2人含税服共 ¥43,560 · 当店付款 (已在 Tabelog My Page 核实生效) · 银座 6-4-18 B1F。"
        },
        {
          time: "12/18 (周五) 12:00",
          tag: "🥂 7周年午餐 Day 5 (✅已预约)",
          title: "銀座 kappou ukai · Tabelog #E3YXY4QXVN",
          desc: "吧台禁烟 · おまかせランチコース (最长2小时) · 2人含15%服务费共 ¥30,360 (饮品另计) · 银座 8-9-15 JEWEL BOX GINZA B1F。"
        }
      ]
    },
    {
      id: "leg5",
      shortTitle: "Leg 5 · 福冈 & 由布院温泉",
      dates: "12/19 – 12/27 (8晚)",
      nights: 8,
      city: "九州福冈博多 & 大分由布院 (Fukuoka & Yufuin)",
      hotel: "Grand Hyatt Fukuoka (2晚+5晚) & 由布院 亀の井別荘 (1晚)",
      hotelConf: "福冈君悦 (博多运河城直通) + 由布院顶级御三家温泉旅馆",
      roomType: "12/21 将大箱寄存福冈君悦，轻装住由布院1晚",
      icon: "♨️",
      color: "#ea580c",
      summary: "羽田飞福冈 → 福冈君悦2晚 → 寄存大箱去由布院「龟之井别庄」泡汤1晚 → 回福冈君悦连住5晚过圣诞 & 九州一日游",
      mapCenter: [33.42, 130.88],
      mapZoom: 9,
      modules: [1, 2, 3, 4, 8, 9, 10, 12, 13, 15, 16, 17, 18],
      schedule: [
        {
          time: "12/19 (周六)",
          tag: "✈️ 飞往九州福冈",
          title: "东京羽田机场 (HND) → 福冈机场 (FUK) → 福冈君悦酒店 (Stay 1: 12/19–21)",
          desc: "福冈机场距离市区极近，打车约 15 分钟即可直达博多运河城旁的 Grand Hyatt Fukuoka。品尝正宗博多豚骨拉面（硬面バリカタ + 替玉加面）与明太子。"
        },
        {
          time: "12/21 (周一) – 12/22 (周二)",
          tag: "♨️ 由布院御三家温泉",
          title: "寄存大行李 → 由布院「亀の井別荘 (Kamenoi Bessou)」一泊二食",
          desc: "12/21 退房时将所有大行李箱寄存在福冈君悦礼宾部，只带 1 晚轻便包前往由布院金鳞湖畔的顶级名宿「龟之井别庄」，享受私人庭园温泉、怀石料理与清晨仙境般的金鳞湖晨雾。"
        },
        {
          time: "12/22 (周二) – 12/27 (周日)",
          tag: "🎄 福冈圣诞周 & 九州游",
          title: "返回福冈君悦连住 5 晚 (Stay 2: 12/22–27)",
          desc: "取回寄存的大行李，连住 5 晚欢度圣诞周！逛中洲/博多圣诞市集、运河城灯光秀、大濠公园、面包超人博物馆，并可灵活安排熊本城/熊本熊或门司港复古铁道一日游。"
        }
      ]
    },
    {
      id: "leg6",
      shortTitle: "Leg 6 · 东京浜松町跨年",
      dates: "12/27 – 1/10 (14晚)",
      nights: 14,
      city: "东京浜松町 / 大门 (Hamamatsucho / Daimon)",
      hotel: "Airbnb: 001｜浜松町・大門｜徒歩3分｜空港直結｜東京タワー近く",
      hotelConf: "连住14晚温馨公寓 · 浜松町站/大门站步行3分钟",
      roomType: "东京都港区浜松町2丁目 (近东京塔 & 增上寺)",
      icon: "⛩️",
      color: "#059669",
      summary: "福冈飞羽田 → 单轨15分钟直达浜松町 → 14晚东京生活、增上寺/东京塔跨年与新年初诣 → 1/10 晚 ZIPAIR 返程旧金山",
      mapCenter: [35.6565, 139.752],
      mapZoom: 15,
      modules: [1, 2, 3, 8, 10, 11, 12, 14, 15, 16, 17, 18],
      schedule: [
        {
          time: "12/27 (周日)",
          tag: "🚝 机场直通公寓",
          title: "福冈 (FUK) → 羽田机场 (HND) → 东京单轨电车直达浜松町站 (13–18分钟)",
          desc: "下飞机后搭乘 Tokyo Monorail 直达终点站「浜松町 (Hamamatsucho)」，步行 3 分钟即达 Airbnb 公寓。周边有 JR 山手线、都营大江户线与浅草线（大门站）。"
        },
        {
          time: "12/31 除夕 – 1/3 元旦",
          tag: "⛩️ 增上寺跨年 & 初诣",
          title: "步行前往东京塔 & 增上寺 (Zojoji Temple) 新年参拜 (初詣)",
          desc: "公寓步行即可到达增上寺与芝公园游乐场！体验日本大晦日跨年氛围、新年初诣祈福、求御守与神签 (おみくじ)、品尝年越荞麦面与百货公司新年福袋 (初売り)。"
        },
        {
          time: "1/10 (周日) 16:30 → 21:25",
          tag: "✈️ 圆满返程旧金山",
          title: "浜松町/大门 → 成田 T1 → ZIPAIR ZG026 (21:25 起飞 → 同日 13:45 抵 SFO)",
          desc: "享受完整的最后一天东京时光！16:30–17:00 左右从大门站搭乘都营浅草线/京成 Sky Access 直达成田 T1（或从品川/东京站乘 JR N'EX），搭乘 21:25 ZG026 (#CYBNOT · 座位 19G, 18J, 18H) 飞回旧金山。"
        }
      ]
    }
  ],

  // 7 Accommodations with exact Lat/Lng for Interactive Map & Taxi Cards
  accommodations: [
    {
      id: "hotel-1",
      legId: "leg1",
      dates: "12/6 – 12/7 (1晚)",
      name: "Hotel Nikko Narita",
      jpName: "ホテル日航成田",
      address: "〒286-0106 千葉県成田市取香500",
      lat: 35.7825,
      lng: 140.3802,
      note: "Conf #25050SH056067 · One Harmony #302035054 · Comfort Triple (¥19,170) · 成田T1 1F 16号站每20分钟免费接驳",
      taxiDriverText: "運転手さん、こちらの「ホテル日航成田」（成田市取香500）までお願いします。"
    },
    {
      id: "hotel-2",
      legId: "leg2",
      dates: "12/7 – 12/9 (2晚)",
      name: "The Prince Sakura Tower Tokyo",
      jpName: "ザ・プリンス さくらタワー東京",
      address: "〒108-8612 東京都港区高輪 3-13-1",
      lat: 35.6267,
      lng: 139.7361,
      note: "品川站高轮口步行3分钟 · 入住 15:00 / 退房 12:00 · 12/9 退房时把大箱转去隔壁新高轮格兰王子寄存",
      taxiDriverText: "運転手さん、品川駅高輪口の「ザ・プリンス さくらタワー東京」（港区高輪3-13-1）の正面玄関までお願いします。"
    },
    {
      id: "hotel-3",
      legId: "leg3",
      dates: "12/9 – 12/12 (3晚)",
      name: "Karuizawa Prince Hotel East",
      jpName: "軽井沢プリンスホテル イースト",
      address: "〒389-0193 長野県北佐久郡軽井沢町大字軽井沢 1016-75",
      lat: 36.3402,
      lng: 138.6416,
      note: "轻井泽站南口接驳车/出租车 · 紧邻滑雪场雪道入口、儿童滑雪学校与森林温泉",
      taxiDriverText: "運転手さん、「軽井沢プリンスホテル イースト」（イースト館のロビー）までお願いします。"
    },
    {
      id: "hotel-4",
      legId: "leg4",
      dates: "12/12 – 12/19 (7晚)",
      name: "Grand Prince Hotel Shin Takanawa",
      jpName: "グランドプリンスホテル新高輪",
      address: "〒108-8612 東京都港区高輪 3-13-1",
      lat: 35.6258,
      lng: 139.7347,
      note: "保育园周与银座纪念日驻地 · 入住时领取 12/9 从樱花塔转存过来的2个大行李箱",
      taxiDriverText: "運転手さん、品川の「グランドプリンスホテル新高輪」（港区高輪3-13-1）の正面玄関までお願いします。"
    },
    {
      id: "hotel-5",
      legId: "leg5",
      dates: "12/19 – 12/21 & 12/22 – 12/27 (2晚+5晚)",
      name: "Grand Hyatt Fukuoka",
      jpName: "グランドハイアット福岡",
      address: "〒812-0018 福岡県福岡市博多区住吉 1-2-82（キャナルシティ博多）",
      lat: 33.5902,
      lng: 130.4111,
      note: "与博多运河城相连 · 福冈机场打车15分钟 · 12/21 退房时将大行李寄存至 12/22 回来连住5晚",
      taxiDriverText: "運転手さん、キャナルシティ博多の「グランドハイアット福岡」（博多区住吉1-2-82）の正面玄関までお願いします。"
    },
    {
      id: "hotel-6",
      legId: "leg5",
      dates: "12/21 – 12/22 (1晚)",
      name: "Yufuin Kamenoi Bessou",
      jpName: "由布院 亀の井別荘（かめのいべっそう）",
      address: "〒879-5102 大分県由布市湯布院町川上 2633-1",
      lat: 33.2669,
      lng: 131.3688,
      note: "由布院御三家顶级温泉旅馆 · 紧邻金鳞湖与键屋 · 仅带1晚过夜包入住",
      taxiDriverText: "運転手さん、金鱗湖の近くの「亀の井別荘」（湯布院町川上2633-1）までお願いします。"
    },
    {
      id: "hotel-7",
      legId: "leg6",
      dates: "12/27 – 1/10 (14晚)",
      name: "Airbnb 001｜浜松町・大門",
      jpName: "浜松町・大門 Airbnb（港区浜松町2丁目）",
      address: "〒105-0013 東京都港区浜松町2丁目（浜松町駅・大門駅 徒歩3分）",
      lat: 35.6554,
      lng: 139.7547,
      note: "近东京塔、增上寺、芝公园 · 羽田单轨直达浜松町 (15分钟) / 都营浅草线大门站直达成田",
      taxiDriverText: "運転手さん、JR浜松町駅の近くの「港区浜松町2丁目」のこちらの住所までお願いします。"
    }
  ],

  // 5 Ginza 7th Marriage Anniversary Lunches (Dec 14–18, 2026) with coordinates & full Tabelog details
  ginzaLunches: [
    {
      id: "ginza-1",
      legId: "leg4",
      date: "12/14 (周一) 11:00",
      status: "pending",
      statusLabel: "⏳ 待绑卡确认 (Not Booked Yet)",
      name: "Sushi Ginza Onodera (鮨 銀座おのでら 総本店)",
      jpName: "鮨 銀座おのでら 総本店",
      address: "東京都中央区銀座 5-14-14 サンリット銀座ビル III 2F",
      lat: 35.6689,
      lng: 139.7675,
      course: "Tsuki Course (月コース) · カウンター席 (吧台2名)",
      price: "¥12,100/人 · 2人共 ¥24,200 (到店付款)",
      resCode: "待完成取消政策信用卡担保绑定",
      cancelPolicy: "需完成信用卡绑定后方视为预约成功",
      highlight: "正统江户前寿司板前 · 东银座站步行2分钟 · ⚠️ 目前卡在预订表单信用卡担保步骤，确认前请勿视为已订妥"
    },
    {
      id: "ginza-2",
      legId: "leg4",
      date: "12/15 (周二) 11:30",
      status: "booked",
      statusLabel: "✅ 已预约 (BOOKED)",
      name: "Ginza Yokota (銀座 よこ田)",
      jpName: "銀座 よこ田",
      address: "東京都中央区銀座 5-5-11 塚本不動産ビル 5F-B",
      lat: 35.6712,
      lng: 139.7646,
      course: "天婦羅と寿司 昼コース (16品 · 90分钟 · 座位不限 2名)",
      price: "¥6,900 + 10%服务费 = ¥7,590/人 · 2人共 ¥15,180 (到店付款)",
      resCode: "Tabelog #TD6NPNPJZH",
      cancelPolicy: "前一天取消收 50%，当天取消收 100%",
      highlight: "米其林星级传承天妇罗与寿司双享套餐"
    },
    {
      id: "ginza-3",
      legId: "leg4",
      date: "12/16 (周三) 12:00",
      status: "booked",
      statusLabel: "✅ 已预约 (BOOKED · 完全個室)",
      name: "Ginza Yamashina (銀座 山科)",
      jpName: "銀座 山科",
      address: "東京都中央区銀座 6-4-3 GICROS GINZA GEMS 7F",
      lat: 35.6708,
      lng: 139.7634,
      course: "完全個室(禁烟包厢) · 早割レアカツシャトーブリアンコース (13品 · 2小时)",
      price: "¥15,000 + 10%服/包厢费 = 2人共 ¥33,000 (另需每人必点1杯饮品)",
      resCode: "Tabelog #899X3CQLAL",
      cancelPolicy: "前一天取消收 100%，当天取消收 100%",
      highlight: "名物夏多布里昂炸牛排 · 💡 含生肉料理（可请主厨帮 Sherry 炙烤/做熟）· 需每人点1杯饮料"
    },
    {
      id: "ginza-4",
      legId: "leg4",
      date: "12/17 (周四) 12:00",
      status: "booked",
      statusLabel: "✅ 已预约 (BOOKED · Tabelog后台已核实)",
      name: "Akita Gyu Teppan Yaki Ginza Gomei (秋田牛鉄板焼 銀座 五明)",
      jpName: "秋田牛鉄板焼 銀座 五明",
      address: "東京都中央区銀座 6-4-18 マキシ・ド・ピアビル B1F",
      lat: 35.6704,
      lng: 139.7623,
      course: "カウンター禁煙 (吧台禁烟 · 2小时) · 【ランチ】ステーキコース",
      price: "¥19,800 + 10%服务费 = 2人共 ¥43,560 (到店付款)",
      resCode: "Tabelog #JSZXLQDDQV",
      cancelPolicy: "前一天取消收 100%，当天取消收 100%",
      highlight: "A5秋田牛铁板烧板前 · 推荐五分熟 (ミディアムレア) · 注：Gmail未收到确认信，但已在 Tabelog My Page 核实预约有效"
    },
    {
      id: "ginza-5",
      legId: "leg4",
      date: "12/18 (周五) 12:00",
      status: "booked",
      statusLabel: "✅ 已预约 (BOOKED)",
      name: "Kappou Ukai (銀座 kappou ukai)",
      jpName: "銀座 kappou ukai",
      address: "東京都中央区銀座 8-9-15 JEWEL BOX GINZA B1F",
      lat: 35.6672,
      lng: 139.7621,
      course: "カウンター禁煙 (吧台禁烟 · 最长2小时) · おまかせランチコース",
      price: "¥13,200 + 15%服务费 = ¥15,180/人 · 2人共 ¥30,360 (饮品另计)",
      resCode: "Tabelog #E3YXY4QXVN",
      cancelPolicy: "前一天取消收 50%，当天取消收 100%",
      highlight: "Ukai集团顶级割烹板前 · 结婚7周年纪念日收官午餐"
    }
  ],

  // Additional Key Transit & Landmark Pins for the Interactive Map
  landmarks: [
    {
      id: "lm-nrt",
      legId: "leg1",
      category: "airport",
      icon: "✈️",
      name: "成田国际机场 T1 (Narita Terminal 1)",
      jpName: "成田国際空港 第1ターミナル",
      address: "千葉県成田市三里塚御料牧場1-1",
      lat: 35.7647,
      lng: 140.3863,
      note: "12/6 19:55 ZG025 抵达 (1F 16号站乘日航酒店巴士) · 1/10 21:25 ZG026 返程"
    },
    {
      id: "lm-shinagawa",
      legId: "leg2",
      category: "transit",
      icon: "🚆",
      name: "JR 品川站 高轮口 (Shinagawa Station Takanawa Exit)",
      jpName: "品川駅 高輪口",
      address: "東京都港区高輪3丁目",
      lat: 35.6284,
      lng: 139.7387,
      note: "N'EX 成田特快直达站 · 过马路步行3分钟即达樱花塔与新高轮格兰王子大饭店"
    },
    {
      id: "lm-karuizawa-ski",
      legId: "leg3",
      category: "attraction",
      icon: "⛷️",
      name: "轻井泽王子滑雪场 & 奥特莱斯",
      jpName: "軽井沢プリンスホテルスキー場 & ショッピングプラザ",
      address: "長野県北佐久郡軽井沢町軽井沢",
      lat: 36.3418,
      lng: 138.6348,
      note: "Jinny 双板滑雪课、Jaycie 玩雪乐园、轻井泽王子购物广场大型奥特莱斯"
    },
    {
      id: "lm-hnd",
      legId: "leg5",
      category: "airport",
      icon: "✈️",
      name: "东京羽田机场 (Haneda Airport)",
      jpName: "羽田空港 (東京国際空港)",
      address: "東京都大田区羽田空港",
      lat: 35.5494,
      lng: 139.7798,
      note: "12/19 飞往福冈 · 12/27 从福冈飞回羽田并换乘东京单轨电车 15 分钟直达浜松町"
    },
    {
      id: "lm-fuk",
      legId: "leg5",
      category: "airport",
      icon: "✈️",
      name: "福冈机场 (Fukuoka Airport)",
      jpName: "福岡空港",
      address: "福岡県福岡市博多区下臼井778-1",
      lat: 33.5859,
      lng: 130.4507,
      note: "距博多市区最近的机场，打车 15 分钟直达福冈君悦酒店"
    },
    {
      id: "lm-zojoji",
      legId: "leg6",
      category: "attraction",
      icon: "⛩️",
      name: "增上寺 & 东京塔 (Zojoji Temple & Tokyo Tower)",
      jpName: "増上寺・東京タワー・芝公園",
      address: "東京都港区芝公園 4-7-35",
      lat: 35.6574,
      lng: 139.7482,
      note: "距离浜松町 Airbnb 步行可达 · 跨年与元旦新年初诣参拜、芝公园儿童游乐场"
    }
  ]
};
