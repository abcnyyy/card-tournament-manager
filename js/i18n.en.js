/**
 * i18n.en.js —— 英文字典（中文原文 → 英文）
 *
 * 词条来源：tools/extract_i18n.js 扫描真实渲染结果（全部页签 + 面板 + 弹窗 + 导出报表）得到的中文原文。
 * 查表规则：
 *   · 这里是「整串精确匹配」，只放渲染后真正出现的句子 / 标签，不要放代码里被拼碎的片段；
 *   · 带数字 / 选手名的句子放 I18n.rules（正则规则），不要一条条穷举；
 *   · 新增中文文案后跑 `node tools/extract_i18n.js --check`，会把漏翻的列出来（顺便当冒烟）。
 *
 * 术语约定（改文案时保持一致）：
 *   赛事 tournament · 阶段 stage · 轮 round · 桌 table · 场 matchboard · 局 game · 回合 set
 *   瑞士轮 Swiss · 循环赛 Round robin · 单败淘汰 Single elimination · 双败淘汰 Double elimination · 小组赛 Groups
 *   轮空 bye · 积分 points · 名次 rank · 晋级 advance · 淘汰 eliminated · 退赛 withdrawn · 判负 forfeit
 *   累计小分 cumulative · 净小分 score diff · 对手分 Buchholz · 累进分 progressive · 大比分 match score
 */
(function (global) {
  'use strict';
  var I = global.I18n = global.I18n || {};

  /* ============ 1. 外壳 / 导航 / 通用按钮 ============ */
  Object.assign(I.dict = I.dict || {}, {
    '卡牌赛事编排': 'Card Tournament Manager',
    '本地离线 · 无需联网': 'Offline · No network needed',
    '赛事列表': 'Tournaments',
    '赛事设置': 'Setup',
    '选手管理': 'Players',
    '对阵与录入': 'Matches',
    '排名': 'Standings',
    '导出': 'Export',
    '赛季积分': 'Season',
    '新建赛事': 'New tournament',
    '+ 新建赛事': '+ New tournament',
    '保存': 'Save',
    '载入存档': 'Load file',
    '中文': '中文',
    '切换到中文': 'Switch to Chinese',
    '未打开赛事': 'No tournament open',
    '未创建赛事': 'No tournament yet',
    '已保存到本机': 'Saved to this device',
    '保存设置': 'Save settings',

    /* 列表页 / 空状态 */
    '新建 / 导入赛事': 'Create / import a tournament',
    '新赛事名称': 'New tournament name',
    '导入 JSON 存档': 'Import JSON save',
    '还没有任何赛事。请输入名称后点击「新建赛事」，或导入已有的 JSON 存档。':
      'No tournaments yet. Type a name and click "New tournament", or import an existing JSON save.',
    '所有数据仅保存在本机浏览器中，不上传任何服务器。可随时导出 JSON 存档备份或迁移到其他设备。':
      'Everything is stored locally in this browser — nothing is uploaded. Export a JSON save any time to back up or move to another device.',
    '打开': 'Open',
    '复制': 'Duplicate',
    '状态': 'Status',
    '选手': 'Players',
    '操作': 'Actions',
    '阶段': 'Stage',
    '赛季': 'Season',
    '未开始': 'Not started',
    '进行中': 'Running',
    '已结束': 'Finished',
    '更新时间': 'Updated',
    '— 不归属 —': '— none —',
    '已有赛事（0）': 'Tournaments (0)',
    '已有赛事（6）': 'Tournaments (6)',
    '已有赛事（1）': 'Tournaments (1)',

    /* 空赛事提示 */
    '请先在「② 选手管理」中导入参赛选手。': 'Import players first in "② Players".',
    '选手列表（0 人）': 'Player list (0)',
    '尚未导入任何选手。请在上方文本框粘贴名单后点击「导入名单」。':
      'No players yet. Paste a name list into the box above, then click "Import list".',
    '暂无选手数据。': 'No player data yet.',

    /* ============ 2. 选手管理 ============ */
    '选手列表（16 人）': 'Player list (16)',
    '选手列表（8 人）': 'Player list (8)',
    '选手列表（12 人）': 'Player list (12)',
    '姓名': 'Name',
    '种子': 'Seed',
    '初始分': 'Initial points',
    '备注': 'Note',
    '在赛': 'Active',
    '退赛': 'Withdrawn',
    '取消资格': 'Disqualified',
    '导出名单': 'Export list',
    '导入名单': 'Import list',
    '清空全部': 'Clear all',
    '批量导入选手': 'Bulk import players',
    '批量导入队伍': 'Bulk import teams',
    '+ 添加单个选手': '+ Add one player',
    '+ 添加单个队伍': '+ Add one team',
    '按当前顺序编种子号': 'Renumber seeds by current order',
    '从文件导入 (txt/csv)': 'Import from file (txt/csv)',
    '从文件导入选手 (txt/csv)': 'Import players from file (txt/csv)',
    '种子号用于初始排位（蛇形分组 / 淘汰赛 bracket 位置），0 或留空表示无种子。':
      'Seeds drive initial placement (snake groups / bracket slots). 0 or blank means unseeded.',
    '起始阶段': 'Start stage',
    '从后续阶段开始': 'Start in a later stage',
    '队': 'Team',
    '队员': 'Members',
    '+ 队员': '+ Member',
    '队伍列表（4 队）': 'Team list (4)',

    /* ============ 3. 对阵与录入 ============ */
    '轮次': 'Round',
    '比分': 'Score',
    '结算': 'Apply',
    '明细': 'Details',
    '收起': 'Hide',
    'A 胜': 'A wins',
    'B 胜': 'B wins',
    '平': 'Draw',
    '这一局平局': 'This game is a draw',
    '撤销上局': 'Undo game',
    '已录完': 'Recorded',
    '警告': 'Warning',
    '判负': 'Forfeit',
    '回退一步': 'Undo last step',
    '实时战绩': 'Live record',
    '全轮暂停': 'Pause all',
    '全轮开始计时': 'Start all timers',
    '回到最新轮': 'Back to latest round',
    '最新': 'Latest',
    '下方': 'below',
    '当前': 'Current',
    '生成下一轮': 'Generate next round',
    '生成下一轮（胜者组 / 败者组）': 'Generate next round (winners / losers)',
    '生成首轮对阵': 'Generate first round',
    '结算本轮': 'Commit round',
    '完成本轮': 'Finish round',
    '完成本轮（结算）': 'Finish round',
    '手动编排本轮': 'Arrange manually',
    '结束本阶段并晋级': 'Finish stage & advance',
    '重新抽签': 'Redraw',
    '导出本轮 JPG': 'Export round JPG',
    '有未完场': 'Unfinished matches',
    '归零': 'Reset',
    '开始计时': 'Start',
    '+5 分钟': '+5 min',
    '按名单排阵': 'Line up by roster',
    '清空未打的': 'Clear unplayed',
    '按未打完结算': 'Settle as unfinished',
    '第 1 阶段（瑞士轮）': 'Stage 1 (Swiss)',
    '第 1 阶段（双败淘汰）': 'Stage 1 (Double elimination)',
    '第 1 阶段（小组赛）': 'Stage 1 (Groups)',
    '第 1 阶段（循环赛）': 'Stage 1 (Round robin)',
    '淘汰赛（单败淘汰）': 'Knockout (Single elimination)',
    '尚未生成对阵。点上方「生成首轮对阵」自动排，或点「手动摆放首轮位」自己把选手摆进首轮座位表。':
      'No matches yet. Click "Generate first round" above, or "Place first-round slots manually" to seat players yourself.',
    '本阶段对阵已全部结束，请点击「结束本阶段并晋级」。':
      'All matches in this stage are done — click "Finish stage & advance".',
    '第 3 轮 · 当前': 'Round 3 · current',
    '本轮尚有未完成的比赛：未完成：选手1 vs 选手2':
      'Some matches in this round are unfinished: 选手1 vs 选手2',
    '参赛：': 'Players: ',
    '轮次：': 'Round: ',
    '赛事：': 'Tournament: ',
    '状态：': 'Status: ',
    '当前阶段：': 'Current stage: ',
    '每轮配对：': 'Pairing: ',
    '本阶段记分：': 'Stage scoring: ',
    '本阶段局制：': 'Stage format: ',
    '首轮编排：': 'First round: ',
    '阶段：': 'Stage: ',
    'N 分': 'N pts'
  });

  /* ============ 3b. 赛事设置页 ============ */
  Object.assign(I.dict, {
    '基本信息': 'Basics',
    '赛事名称': 'Tournament name',
    '局制（默认值，可被单个阶段覆盖）': 'Match format (defaults; per-stage override)',
    '记分规则（默认值，可被单个阶段覆盖）': 'Scoring (defaults; per-stage override)',
    '每场比赛局数': 'Games per match',
    '获胜所需局数': 'Games to win',
    '记录每局具体比分': 'Record per-game scores',
    '回合（局之上的一层）': 'Sets (a layer above games)',
    '每场比赛回合数': 'Sets per match',
    '团体赛': 'Team event',
    '本赛事为团体赛': 'This is a team event',
    '团体赛赛制': 'Team mode',
    '每队人数': 'Team size',
    '每方上场人数': 'Players per side',
    '比赛场制': 'Board format',
    '一桌 = 一场比赛': 'One table = one match',
    '先定人、再录成绩': 'Line up first, then record',
    '所有场次一次打完': 'All boards played at once',
    '队员不一定等于上场人数': 'Members may exceed the number fielded',
    '必须先把整场所有对局的对阵都排好': 'All boards must be lined up first',
    'KOF 拳皇（把对方全员都击败）': 'KOF (beat every opponent player)',
    '征服赛制（本方全员各赢一场才算赢）': 'Conquest (every player on your side must win once)',
    'n 对 n（双方同时开打，赢下场数多者胜）': 'n vs n (all boards at once, most board wins)',
    '比赛计时器': 'Match timer',
    '启用每场限时': 'Enable per-match time limit',
    '每场限时（分钟）': 'Time limit (minutes)',
    '到点自动结算': 'Auto-settle when time is up',
    '到点时双方局数相同': 'If scores are level at timeout',
    '种子号靠前者获胜': 'Higher seed wins',
    '不结算，继续打（停表由裁判决定）': 'Do not settle — keep playing (judge decides)',
    '记为平局（双方按「未打完」档位得分）': 'Record a draw (both get the "unfinished" tier)',
    '赛事积分榜': 'Tournament points table',
    '启用本赛事的积分榜体系': 'Enable the points table for this event',
    '这场赛事怎么给分': 'How this event awards points',
    '按名次给分': 'By final rank',
    '按胜场给分': 'By wins',
    '按是否晋级下一阶段给分': 'By advancing to the next stage',
    '三种计分方式选一种：名次 / 胜场 / 是否晋级下一阶段。':
      'Pick one: by final rank / by wins / by advancing to the next stage.',
    '名次分档（几个名次一档）': 'Rank tiers (ranks per tier)',
    '+ 加一档': '+ Add tier',
    '延伸最后一档到第 N 名': 'Extend the last tier to rank N',
    '之后每降 1 名扣': 'Each further rank costs',
    '第 25 名起按这个步长递减': 'From rank 25 on, decrease by this step',
    '扣到这个分数就不再往下扣': 'Never go below this score',
    '+ 添加阶段': '+ Add stage',
    '复制当前阶段': 'Duplicate current stage',
    '删除当前阶段': 'Delete current stage',
    '赛程阶段（多阶段赛制）': 'Stages (multi-stage events)',
    '编辑阶段：': 'Editing stage: ',
    '阶段名称': 'Stage name',
    '赛制类型': 'Stage format',
    '轮数': 'Rounds',
    '每轮配对方式': 'Pairing per round',
    '晋级条件': 'Advancement',
    '晋级方式': 'Advancement',
    '全部晋级': 'Everyone advances',
    '按名次人数晋级': 'Top N advance',
    '按积分线晋级': 'Above a points line',
    '固定人数晋级（同分同名次，同分者一起晋级）': 'Fixed count (ties advance together)',
    '添加依据': 'Add tiebreaker',
    '排名依据（Tiebreaker）': 'Tiebreakers',
    '先比判负、再比警告': 'Forfeits first, then warnings',
    '越少越靠前': 'fewer is better',
    '相互胜负关系': 'Head-to-head',
    '对手分总和 (Buchholz)': 'Buchholz (opponents\' scores)',
    '净胜局数': 'Game difference',
    '赢下局数': 'Games won',
    '输掉局数（越少越靠前）': 'Games lost (fewer is better)',
    '胜场数': 'Wins',
    '累进分（每轮后积分累加）': 'Progressive score',
    '累计小分': 'Cumulative score',
    '净小分（累计小分 − 对手小分）': 'Score difference (own − opponents)',
    '上一阶段得分': 'Previous stage points',
    '初始种子序': 'Initial seed',
    '手动指定': 'Manual order',
    '每个阶段单独作为一个依据': 'Each stage as its own tiebreaker',
    '单独设置': 'Custom',
    '阶段单独设置': 'Per-stage custom rules',
    '独立局制': 'Custom format',
    '独立记分': 'Custom scoring',
    '本阶段单独设置局制': 'Custom format for this stage',
    '本阶段单独设置记分方式': 'Custom scoring for this stage',
    '本阶段局制与记分': 'Format & scoring for this stage',
    '本阶段平局判定': 'Draw handling for this stage',
    '本阶段单独设置记分方式': 'Custom scoring for this stage',
    '本阶段的积分怎么合': 'How this stage\'s points combine',
    '晋级保证': 'Clinch bonus',
    '提前晋级 / 提前淘汰': 'Early clinch / early elimination',
    '启用自动判定': 'Enable automatic decision',
    '达到几胜 → 提前晋级': 'Wins needed → early clinch',
    '达到几负 → 提前淘汰': 'Losses needed → early elimination',
    '提前晋级者下一阶段加分': 'Bonus for players who clinch early',
    '每提前一轮额外加分': 'Extra points per round clinched early',
    '越早锁定，起手分越高': 'The earlier they clinch, the bigger the head start',
    '提前锁定下一阶段席位': 'Locks a seat in the next stage',
    '中途淘汰（按名次裁人）': 'Mid-stage cut (by rank)',
    '启用中途淘汰': 'Enable mid-stage cut',
    '第几轮结束后淘汰': 'Cut after round #',
    '保留前几名': 'Keep top N',
    '系统自动判定': 'System decides',
    '双方都输': 'Both lose',
    '任何平局都不按平局计分': 'No draw is scored as a draw',
    '任何平局都不分胜负、双方各记一负': 'Every draw counts as a loss for both sides',
    '计分单元': 'Scoring unit',
    '整站算一次分': 'Once for the whole event',
    '站内每个阶段各算一次': 'Once per stage',
    '跟随赛事默认': 'Follow event default',
    '跟随赛事默认（当前：叠加）': 'Follow event default (now: stacked)',
    '与上一阶段叠加（累加）': 'Stack with previous stage',
    '不叠加：只有晋级到本阶段的人重新起算': 'No stacking: only advancing players restart',
    '只拿本阶段这一笔分': 'Only this stage\'s points count',
    '回合数': 'Sets per match',
    '计分方式': 'Scoring mode',
    '按胜负平轮空积分（自定义分值）': 'Win / draw / loss / bye points (custom)',
    '按大比分逐档设分（列出所有可能比分分别设分）': 'Per match-score tier (set points for every possible score)',
    '按赢下局数计分（每局分值）': 'Points per game won',
    '按小分累加（需记录每局比分）': 'Sum of game scores (needs per-game scores)',
    '自定义公式（表达式）': 'Custom formula (expression)',
    '胜负平积分（胜 3 / 平 1 / 负 0 / 轮空 3）': 'Win / draw / loss (W3 / D1 / L0 / bye 3)',
    '胜一场得': 'Win is worth',
    '平一场得': 'Draw is worth',
    '负一场得': 'Loss is worth',
    '轮空得': 'Bye is worth',
    '0 = 不加分': '0 = no points',
    '0 = 不设晋级线': '0 = no clinch line',
    '0 = 不设淘汰线': '0 = no elimination line',
    '手动指定': 'Manual order',
    '排名依据（Tiebreaker）': 'Tiebreakers',
    '同档同分': 'Same tier, same points',
    '晋级线内': 'Above the line',
    '排序规则': 'Ordering',
    '判定依据': 'Criteria',
    '按场次（大比分 胜 / 负）': 'By match score (wins / losses)',
    '按小局（赢下 / 输掉的局数）': 'By games (won / lost)',
    '比赛计时器': 'Match timer',
    '轮空方式': 'Bye policy',
    '轮空规则（人数为奇数时）': 'Bye rules (odd player count)',
    '平局处理': 'Draw handling',
    '自动加赛决胜局（推荐）': 'Automatic tiebreak game (recommended)',
    '允许平局（不用于淘汰赛）': 'Allow draws (not for knockout)',
    '由裁判手动指定晋级者': 'Judge picks the winner',
    '自动配对（积分相近者优先，不重复交手）': 'Auto (similar scores, avoid rematches)',
    '自动配对（积分相近者优先）': 'Auto (similar scores)',
    '随机配对（每轮重新抽签）': 'Random (redraw every round)',
    '手动编排（生成时自己点选配对）': 'Manual (pick pairings yourself)',
    '自动：首轮随机，之后给最低分（每人最多轮空一次）': 'Auto: random first round, then lowest score (one bye each)',
    '自动：始终给当前积分最低者': 'Auto: always the lowest score',
    '自动：每轮随机抽一人': 'Auto: random player each round',
    '自动排好后，我自己在「手动编排」里改': 'Auto, then I adjust in "Arrange manually"',
    '不结算，继续打（停表由裁判决定）': 'Do not settle — keep playing (judge decides)',
    '这场比赛没有平局处理之外的选项': 'No other options',

    /* ============ 3c. 导出页 ============ */
    '对阵': 'Matches',
    '对阵图': 'Bracket',
    '导出范围': 'Scope',
    '全部轮次': 'All rounds',
    '全部小组': 'All groups',
    '选手名单': 'Player list',
    '小组': 'Group',
    '不经过打印机': 'No printer involved',
    '整站报告与存档': 'Full report & save',
    '导出对阵 CSV': 'Export matches CSV',
    '导出对阵 JPG': 'Export matches JPG',
    '导出对阵 PDF': 'Export matches PDF',
    '导出排名 CSV': 'Export standings CSV',
    '导出排名 PDF': 'Export standings PDF',
    '导出排名 JPG': 'Export standings JPG',
    '导出 JSON 存档': 'Export JSON save',
    '导出完整报告 JPG': 'Export full report JPG',
    '导出完整报告 PDF': 'Export full report PDF',
    '导出全部阶段对阵 CSV': 'Export all stages CSV',
    '导出选手名单 (txt)': 'Export player list (txt)',
    '导出名次 CSV': 'Export ranks CSV',
    '导出对阵图 PDF': 'Export bracket PDF',
    '导出对阵图 JPG': 'Export bracket JPG',
    '导出积分榜 CSV': 'Export points table CSV',
    '存 PDF': 'Save PDF',
    '淘汰赛': 'Knockout',
    '淘汰赛对阵图': 'Knockout bracket',
    '名次 CSV 仍是表格（Excel 用），图片与 PDF 才是对阵图。':
      'The ranks CSV stays a table (for Excel); images and PDF are the bracket.',
    '轮次选择「全部轮次」= 当前最新排名；选择某一轮 = 该轮结束后的排名快照（不含之后的比赛）。':
      '"All rounds" = latest standings; picking a round = the snapshot right after that round.',
    '导出所选阶段的某一轮或全部轮次对阵。CSV 可直接用 Excel / WPS 打开，含大比分、逐局与胜者。':
      'Export one round or every round of the selected stage. The CSV opens in Excel / WPS and includes scores, games and winners.',

    /* ============ 3d. 排名页 ============ */
    '名次': 'Rank',
    '场次': 'Matches',
    '赢局-输局': 'Games W-L',
    '净胜局': 'Game diff',
    '净小分': 'Score diff',
    '累进分': 'Progressive',
    '对手分': 'Buchholz',
    '最好': 'Best',
    '计分次数': 'Stops',
    '手动调序': 'Manual order',
    '胜': 'W',
    '按种子号编排': 'By seed',
    '按种子号': 'By seed',
    '单独设置 · 按名次': 'Custom · by rank',
    '恢复默认': 'Restore defaults',
    '导出直接生成文件，': 'Exports are generated directly as files, ',
    '；JPG 是整张长图，可直接发群 / 发动态。': '; a JPG is one long image, ready to share.',
    '：全场按首轮对阵位平分为上、下两个半区；': ': the field splits into upper and lower halves by first-round slots;',
    '，下半区胜者组的败者掉进上半区败者组。两个半区的败者组各自打完后，两边的败者组冠军先打一场': ', lower-half winners drop into the upper losers bracket. Once both losers brackets finish, their champions play the ',
    '，胜者才进总决赛。': ', and only the winner reaches the grand final.',
    '半区的败者组': ' losers bracket',
    '胜者组某半区的败者，交叉掉入': 'Winners-bracket losers from one half cross into the other half\'s',
    '的败者掉进': ' losers drop into',
    '夺冠（无后续比赛）': 'champion (no further match)',
    '进入加赛局': 'go to the reset match',
    '瑞士轮': 'Swiss',
    '胜负平积分': 'win/draw/loss points',
    '双败': 'double elim',
    '单败': 'single elim',
    '按比赛场次（大比分 胜 / 负）': 'By match score (wins / losses)',
    '判负次数（越少越靠前）': 'Forfeits (fewer is better)',
    '警告次数（越少越靠前）': 'Warnings (fewer is better)',
    '淘汰': 'eliminated',
    '晋级': 'Advance',
    '阶段积分': 'Stage points',
    '提前淘汰': 'Early elimination',
    '双方各记一负': 'both sides take a loss',
    '小分不受影响': 'scores unaffected',
    '对手分照样会变': 'Buchholz still moves',
    '任何平局都判为': 'Every draw counts as',
    '未开始': 'Not started',
    '进行中': 'Running',
    '已结束': 'Finished',
    '负': 'L',
    '提前晋级 / 提前淘汰已启用': 'Early clinch / elimination enabled',
    '提前晋级者不再出场，但仍计入排名与对手分；对手后续赢分，他的对手分也会跟着上涨。':
      'Players who clinched stop playing but still count for ranks and Buchholz; their opponents\' later wins still raise it.',
    '按名次 · 整站一次': 'By rank · whole event',
    '净胜场': 'Board diff',
    '个人小局': 'Individual games',
    '赢场-输场': 'Boards W-L',
    '大比分 = 赢下的场数': 'Match score = boards won',

    /* ============ 3e. 赛季页 ============ */
    '新建赛季': 'New season',
    '+ 新建赛季': '+ New season',
    '赛季名称': 'Season name',
    '赛季名称，例如 2026 秋季联赛': 'Season name, e.g. 2026 Fall League',
    '站数': 'Stops',
    '当前领跑': 'Current leader',
    '创建时间': 'Created',
    '重命名': 'Rename',
    '还没有赛季。取个名字点「新建赛季」，再把赛事归入它就开始了。':
      'No seasons yet. Name one, click "New season", then assign tournaments to it.',
    '赛季把多场赛事串成一条积分线：每站赛事归入同一个赛季后，按你设定的规则自动累计总分。':
      'A season chains tournaments into one points race: once assigned, points accumulate by your rules.',
    '未启用。启用后本赛事会生成积分榜，排名页可查看与导出。':
      'Not enabled. Once on, this event gets a points table you can view and export.',

    /* ============ 3f. 双败 / 淘汰赛细则 ============ */
    '总决赛': 'Grand final',
    '胜者组': 'Winners bracket',
    '败者组': 'Losers bracket',
    '上半区': 'Upper half',
    '下半区': 'Lower half',
    '另一个': 'the other',
    '编排方式': 'Seeding',
    '档内随机': 'random within tier',
    '双双淘汰': 'both eliminated',
    '首轮对阵位': 'First-round slots',
    '总决赛赛制': 'Grand final rules',
    '启用半区互换': 'Enable half-bracket crossover',
    '胜者组败者掉进败者组时重排落位，避免刚交过手的人又碰上':
      'Reorder winners-bracket losers as they drop in, so recent opponents do not meet again',
    '败者组第一轮永远是胜者组第 1 轮相邻两场的败者对打（两种模式都一样，这是标准双败的固定结构）。互换改的是后面每一波掉下来的败者的落位顺序：':
      'The first losers round is always losers of adjacent winners round-1 matches (both modes — that is the standard bracket). Crossover only changes how later waves of losers are placed:',
    '· 第 1 波（胜者组第 1 轮）→ 原样；第 2 波 → 整波反向；第 3 波 → 反向后再平移半数；第 4 波 → 平移半数；第 5 波 → 原样，之后按 4 波循环。':
      '· wave 1 (winners round 1) unchanged; wave 2 reversed; wave 3 reversed and shifted by half; wave 4 shifted by half; wave 5 unchanged, then the cycle repeats.',
    '· 效果：刚在胜者组被谁淘汰的人，不会掉进败者组马上又撞上他；对阵结构、轮数、场次都不变，胜者组决赛的败者照样直接进败者组决赛。':
      '· Effect: a player knocked out in the winners bracket does not immediately face the same opponent again; the structure, round count and match count stay the same, and the winners-final loser still goes straight into the losers final.',
    '· 关闭（默认）：掉下来的败者按到达顺序直接 1:1 落位，不重排。':
      '· Off (default): losers drop in arrival order, one-to-one, with no reordering.',
    '本阶段启用了半区互换（交叉落位）：败者组第一轮仍是胜者组首轮相邻两场的败者对打；从第 2 波起，掉下来的败者会按「反向 / 反向移半 / 移半 / 不变」循环重排落位，避免刚交过手的人再次相遇。':
      'Crossover dropping is on: the first losers round still pairs losers of adjacent winners round-1 matches; from wave 2 on, each wave of losers is reordered (reversed / reversed+shifted / shifted / unchanged) so recent opponents do not meet again.',
    '半区互换已开启：败者组第一轮仍按胜者组首轮相邻两场的败者对打；之后每一波掉下来的败者会按「反向 / 反向移半 / 移半 / 不变」循环重排，避免刚交过手的人再碰上。':
      'Crossover dropping is on: the first losers round still pairs losers of adjacent winners round-1 matches; later waves are reordered (reversed / reversed+shifted / shifted / unchanged) so recent opponents do not meet again.',
    '胜者组掉下来的败者，第一轮就交叉去碰另一个半区的人': 'Winners-bracket losers cross over to face the other half in the first losers round',
    '把全场按首轮对阵位平分为上、下两个半区：败者组第一轮由上半区的败者对下半区的败者（交叉落位），之后就按标准双败推进，避免「刚在胜者组交过手的人、掉进败者组又立即相遇」。':
      'Split the field into upper and lower halves by first-round slots: the first losers round pairs upper-half losers with lower-half losers (crossover), then the bracket proceeds like standard double elim so recent opponents do not meet again.',
    '· 对阵结构仍是标准双败：败者组轮数、场次不变，胜者组决赛的败者照样直接进败者组决赛（不会被提前消耗掉）。':
      '· The structure is still standard double elim: same losers rounds and matches, and the winners-final loser still goes straight into the losers final.',
    '把全场按首轮对阵位平分为上、下两个半区：败者组第一轮由上半区的败者对下半区的败者（交叉落位），之后就按标准双败推进，避免「刚在胜者组交过手的人、掉进败者组又立即相遇」。· 对阵结构仍是标准双败：败者组轮数、场次不变，胜者组决赛的败者照样直接进败者组决赛（不会被提前消耗掉）。':
      'Split the field into upper and lower halves by first-round slots: the first losers-bracket round pairs upper-half losers with lower-half losers (crossover), then the bracket proceeds like standard double elim, so players who just met in the winners bracket do not meet again immediately. · The structure is still standard double elim: same losers-bracket rounds and matches, and the winners-final loser still goes straight into the losers final.',
    '· 对阵图会同步画出交叉后的去向（「负 →」落在哪一场）。': '· The bracket diagram shows where each crossover loser drops.',
    '· 关闭（默认）：传统双败，败者组第一轮是相邻两场掉下来的败者对打（同半区先打）。': '· Off (default): classic double elim — the first losers round pairs losers of adjacent winners-bracket matches (same half first).',
    '本阶段启用了半区互换（crossover）：全场按首轮对阵位平分为上、下两个半区，败者组第一轮由上半区的败者对下半区的败者（交叉落位），之后按标准双败推进；胜者组决赛的败者直接进入败者组决赛。':
      'Half-bracket crossover is on: the field is split into upper and lower halves and the first losers-bracket round crosses halves (upper losers vs lower losers); then the bracket proceeds like standard double elim, with the winners-final loser going straight into the losers final.',
    '败者组配对时优先让不同半区的人相遇': 'Pair the losers bracket across halves whenever possible',
    '把全场按首轮对阵位平分为上、下两个半区，败者组配对时优先挑另一个半区的对手，避免「刚在胜者组交过手的人、掉进败者组又立即相遇」。':
      'Split the field into upper and lower halves by first-round slots, then pair the losers bracket across halves so players who just met in the winners bracket do not meet again immediately.',
    '· 对阵结构仍是标准双败：败者组轮数、场次不变，胜者组决赛的败者照样直接进败者组决赛（不会被提前消耗掉）。':
      '· The bracket structure stays standard double elimination: the losers bracket keeps the same rounds and matches, and the winners-final loser still goes straight into the losers final.',
    '本阶段启用了半区互换（crossover）：全场按首轮对阵位平分为上、下两个半区，败者组配对时优先挑另一个半区的对手；对阵结构仍是标准双败 —— 胜者组决赛的败者直接进入败者组决赛。':
      'Half-bracket crossover is on: the field is split into upper and lower halves by first-round slots and the losers bracket pairs across halves; the structure stays standard double elim, so the winners-final loser goes straight into the losers final.',
    '半区互换已开启：败者组配对时优先让不同半区的选手相遇（避免刚交过手的人再次相遇）；对阵结构仍是标准双败 —— 胜者组决赛的败者直接进入败者组决赛。':
      'Half-bracket crossover is on: the losers bracket pairs across halves (so recent opponents do not meet again); the structure stays standard double elim — the winners-final loser goes straight into the losers final.',
    '：败者组配对时优先让不同半区的选手相遇（避免刚交过手的人再次相遇）；对阵结构仍是标准双败 —— 胜者组决赛的败者直接进入': ': the losers bracket pairs across halves (so recent opponents do not meet again); the structure stays standard double elim — the winners-final loser goes straight into the',
    '败者组决赛。': 'losers final.',
    '（半区互换）': ' (crossover)',
    '首轮编排方式': 'First-round seeding',
    '加赛局独立局制': 'Custom format for the reset match',
    '轮空归谁不会变': 'Byes stay with the same players',
    '直接进入败者组': 'Start in the losers bracket',
    '总决赛独立局制': 'Custom format for the grand final',
    '「败者组交叉决赛」': '"Losers crossover final"',
    '前 N 人从胜者组': 'Top N start in the winners bracket',
    '双败 · 分组起跑': 'Double elim · split start',
    '排名前几名从胜者组打起': 'Top-ranked players start in the winners bracket',
    '双败淘汰 · 总决赛规则': 'Double elim · grand final rules',
    '让局（一方开局先计若干局）': 'Handicap (one side starts with games)',
    '完全随机抽签（全部选手打乱）': 'Fully random draw',
    '分档抽签（按种子分档，档内随机）': 'Tiered draw (seeds by tier, random inside)',
    '无优势（一场定胜负，谁赢谁夺冠）': 'No advantage (one match decides it)',
    '按种子号编排（强手分散，标准种子位）': 'By seed (strong players spread out, standard slots)',
    '手动摆放首轮位（自己把选手摆进对阵位）': 'Place first-round slots yourself',
    '双败 · 半区互换（crossover）': 'Double elim · half-bracket crossover',
    '加赛制（败者组冠军赢下首场后需再加赛一场）': 'Reset rule (losers champion must win twice)',
    '可升格决赛（一场定胜负·比分累计，败者组冠军先到获胜局数后升格）':
      'Promotable final (one match, cumulative score; target rises once the losers champion reaches it)',
    '上半区胜者组': 'Upper-half winners',
    '上半区败者组': 'Upper-half losers',
    '下半区胜者组': 'Lower-half winners',
    '下半区败者组': 'Lower-half losers',
    '胜者组半决赛': 'Winners semifinal',
    '胜者组决赛': 'Winners final',
    '败者组决赛': 'Losers final',
    '败者组交叉决赛': 'Losers crossover final',
    '胜者组冠军': 'Winners champion',
    '败者组冠军': 'Losers champion',
    '胜者组（赢一场留在上面，输一场掉下去）': 'Winners bracket (win = stay, loss = drop)',
    '败者组（再输一场即淘汰）': 'Losers bracket (one more loss = out)',
    '冠军': 'Champion',
    '亚军': 'Runner-up',
    '季军': 'Third place',
    '晋级路径': 'Advancement path',
    '结果': 'Result',
    '来源': 'From',
    '加赛局': 'Reset match',
    '总决赛在最右边': 'The grand final is on the far right',
    '半区互换已开启：败者组配对时优先让不同半区的选手相遇（避免刚交过手的人再次相遇）；对阵结构仍是标准双败 —— 胜者组决赛的败者直接进入败者组决赛。':
      'Half-bracket crossover is on: the losers bracket pairs across halves (so recent opponents do not meet again); the structure stays standard double elim — the winners-final loser goes straight into the losers final.',
    '加赛制：败者组冠军需赢两场': 'Reset rule: the losers champion must win twice',
    '仅当败者组冠军赢下首场才进行': 'Only if the losers champion wins the first match',
    '胜者 → 夺冠（无后续比赛）': 'Win → champion (no further match)',
    '负 → 亚军': 'Loss → runner-up',
    '0 = 全部人从胜者组开始（传统双败）。': '0 = everyone starts in the winners bracket (classic double elim).',
    '未勾选时，加赛局沿用总决赛（或阶段）的局制。':
      'When unchecked, the reset match uses the grand final (or stage) format.',
    '总决赛单独设置局制（例如阶段 BO3、总决赛 BO5）':
      'Custom grand final format (e.g. BO3 in the stage, BO5 in the final)',
    '加赛局单独设置局制（可与总决赛首场不同，例如首场 BO5、加赛 BO1）':
      'Custom reset format (e.g. BO5 first, BO1 reset)',
    '· 不勾选（默认）：双败不允许平局，平局的场次会卡住直到改判或加赛。':
      '· Unchecked (default): no draws in double elim — a drawn match stalls until it is changed or replayed.',
    '· 关闭（默认）：传统双败，胜者组败者统一掉进同一个败者组，按原顺序交错配对。':
      '· Off (default): classic double elim — all winners-bracket losers drop into one losers bracket, interleaved in order.',
    '· 好处：避免「刚在胜者组交过手的人、掉进败者组又立即相遇」，更公平、更接近主流电竞 / 棋类双败（如 CUBA 的上下半区）。':
      '· Why: players who just met in the winners bracket do not meet again immediately in the losers bracket.',
    '双败流程：首轮全部进入胜者组；负一场者掉入败者组，负两场即淘汰；胜者组冠军与败者组冠军进行总决赛。每轮录入完结果后请点「结算本轮」，系统才会推进两组归属。':
      'Double elim flow: everyone starts in winners; one loss drops to losers, two losses eliminate. Winners and losers champions meet in the grand final. Click "Commit round" after each round so drops are applied.',
    '加赛制：败者组冠军必须先赢下首场，才触发第二场加赛；可升格决赛：只打一场、比分累计不重置，败者组冠军先到原获胜局数后目标升格（如先到 3 局→升为 4 局）；无优势：一场定胜负；让局：一方开局先计若干局。':
      'Reset: the losers champion must win the first match to force a reset match. Promotable final: one match with cumulative score; once the losers champion reaches the original target it rises (e.g. 3 → 4). No advantage: one match decides. Handicap: one side starts with games.',
    '例：瑞士轮取 16 人进双败，这里填 8 → 前 8 名进胜者组、9~16 名从败者组打起。':
      'Example: Swiss feeds 16 into double elim; set 8 here → top 8 start in winners, 9–16 in losers.',
    '本阶段 8 人：对阵表 8 位，胜者组 3 轮、败者组 4 轮，负两场淘汰，最后是总决赛。':
      'This stage has 8 players: 8 slots, 3 winners rounds, 4 losers rounds, two losses out, then the grand final.',
    '淘汰赛名次按对阵结果确定：决赛胜者为冠军，负者为亚军；败者组决赛负者为季军，其余按被淘汰的轮次由后往前排列。':
      'Knockout ranks follow the bracket: final winner is champion, loser runner-up; the losers-final loser is third, the rest are ordered by the round they were eliminated.',
    '本阶段启用了半区互换（crossover）': 'Half-bracket crossover is enabled for this stage',
    '本阶段启用了半区互换（crossover）：全场按首轮对阵位平分为上、下两个半区；上半区胜者组的败者掉进下半区败者组，下半区胜者组的败者掉进上半区败者组。两个半区的败者组各自打完后，两边的败者组冠军先打一场「败者组交叉决赛」，胜者才进总决赛。':
      'Crossover is enabled: the field splits into upper and lower halves. Losers from the upper winners bracket drop into the lower losers bracket and vice versa; the two losers champions meet in the "losers crossover final" before the grand final.',
    '把全场按首轮对阵位平分为上、下两个半区：胜者组上半区的败者掉进下半区败者组、下半区的败者掉进上半区败者组。两个半区败者组各自打完、各出一名冠军后，在「败者组交叉决赛」汇合，胜者再去打总决赛。':
      'Split the field into upper and lower halves by first-round slots: losers from the upper half drop into the lower losers bracket and vice versa. Both losers brackets play out, their champions meet in the "losers crossover final", and the winner goes to the grand final.',
    '抽签在点「生成首轮对阵」时自动进行；生成后、开打前可点「重新抽签」换一次结果。轮空人数由「本阶段人数 + 晋级人数」算出，抽签只改变谁碰谁，不改变轮空数量。轮空归谁不会变：按上阶段排名该拿轮空的人，随机 / 分档抽签都不会把他抽离轮空位。':
      'The draw runs when you click "Generate first round"; you can redraw before play starts. Bye count comes from players + advancing slots; a draw only changes who meets whom. Byes stay with the players entitled to them by ranking.',
    '按种子号：标准种子位，1 号与末位同区、强手分散；分档抽签：先按种子分档，档内随机（同档的人互换位置，强弱分布不变）；完全随机抽签：所有选手一起打乱；手动摆放首轮位：首轮不自动排，由你在「③ 对阵与录入」页自己把选手拖进对阵位。':
      'By seed: standard slots, #1 and the last seed in the same half, strong players spread. Tiered draw: seeds grouped into tiers, random inside each tier. Fully random. Manual: you place players into first-round slots on the "③ Matches" page.',
    '填 N（≥2）= 按本阶段排名，前 N 人从胜者组打起，第 N+1 名及以后直接进入败者组；从败者组起跑的人已经算「输过一场」，在败者组再输一场即出局。':
      'N (≥2): the top N by ranking start in winners, the rest in losers. Starting in losers counts as one loss already.',

    /* ============ 3g. 其他 ============ */
    '对阵图（每场 3 局 · 先赢 2 局）': 'Bracket (3 games per match, first to 2)',
    '举例': 'Example',
    '最低分': 'floor',
    '未打完': 'Unfinished',
    '分': 'pts',
    '名': 'rank',
    '上': 'Up',
    '下': 'Down',
    '第': 'No.',
    '队伍': 'Teams',
    '整站': 'Whole event',
    '移除': 'Remove',
    '删除': 'Delete',
    '场数': 'Boards',
    '每轮': 'Per round',
    '不生效': 'has no effect',
    '循环次数': 'Cycles',
    '没维护队员': 'no members yet',
    '按组分别': 'per group',
    '分组方式': 'Grouping',
    '手动分组': 'Manual groups',
    '随机抽签': 'Random draw',
    '蛇形排列（按种子）': 'Snake (by seed)',
    '小组数量': 'Groups',
    '小组内赛制': 'Format inside a group',
    '每组晋级人数': 'Advance per group',
    '组内循环次数': 'Cycles inside a group',
    '组内每轮配对方式': 'Pairing inside a group',
    '场': 'boards',
    '第 1 阶段得分': 'Stage 1 points',
    '第 1 阶段 · 全部轮次': 'Stage 1 · all rounds',
    '淘汰赛 · 全部轮次': 'Knockout · all rounds',
    '逐局': 'Games',
    '桌号': 'Table',
    '大比分': 'Score',
    '选手 A': 'Player A',
    '选手 B': 'Player B',
    '还没有任何淘汰赛阶段生成对阵。': 'No knockout stage has generated matches yet.',
    '本赛事只有 1 个淘汰赛阶段，无需合并。　生成时间：': 'Only one knockout stage — nothing to merge. Generated ',
    'A 组': 'Group A',
    'B 组': 'Group B',
    '1 = 单循环（每人交手一次）；2 = 双循环（主客场各一次）。':
      '1 = single round robin; 2 = double round robin (home and away).',
    '这是最后一个阶段，结束后即为最终排名。': 'This is the last stage — its result is the final ranking.',
    '设置会自动保存；正式开赛后请勿随意修改当前阶段的规则。':
      'Settings save automatically; avoid changing rules once play has started.',
    '推荐轮数 ≈ ⌈log₂(人数)⌉，人数多时可适当增加。': 'Suggested rounds ≈ ⌈log₂(players)⌉; add more for large fields.',
    '按场次：赢 3 场即晋级、输 3 场即淘汰（大比分制）。': 'By matches: 3 wins clinch, 3 losses eliminate.',
    '按小局：累计赢下 6 局即晋级、累计输掉 6 局即淘汰（小局制，轮空不计局）。':
      'By games: 6 games won clinch, 6 lost eliminate (byes do not count).',
    '三种计分方式选一种：名次 / 胜场 / 是否晋级下一阶段。':
      'Pick one: by final rank / by wins / by advancing.',
    '录入时可「直接填几比几」，系统自动判胜负并按这里的分值给分。':
      'Type the score directly; the app decides the winner and awards points here.',
    '例如小组赛按胜负积分、淘汰赛不计分。': 'e.g. points in groups, none in the knockout.',
    '例如小组赛 BO1、淘汰赛 BO5，就分别在不同阶段勾选并设置。':
      'e.g. BO1 in groups, BO5 in the knockout — set it per stage.',
    '开启后，每场比赛都可以在对阵卡片上单独开表倒计时（可暂停、归零、重开）。':
      'When on, each match card gets its own countdown (pause, reset, restart).',
    '开启后录入时可填每局具体比分数字，供「按小分累加 / 自定义公式」使用。':
      'When on, you can enter per-game scores for "sum of scores / custom formula".',
    '默认每场多少分钟，开表时写入该场（之后改这里不影响已在计时的场次）。':
      'Default minutes per match; copied into a match when its timer starts (changing this does not affect running timers).',
    '不勾选 = 到点只标红提醒，由裁判手动结算。': 'Unchecked = only flag it red at timeout; the judge settles.',
    '到点按当前大比分结算：领先方获胜；局数相同时按这里处理。淘汰赛必须有人晋级，所以「记平局」在淘汰赛会自动改为按种子号判定。':
      'At timeout the current score decides: the leader wins; level scores follow this setting. Knockout matches must produce a winner, so "draw" becomes "higher seed wins" there.',
    '打满全部局数后出现平局时如何处理。淘汰赛一般选「自动加赛决胜」；循环赛 / 瑞士轮若允许平局，请选「允许平局」，平局才会按平局分（或大比分表中的平局档）计入。':
      'What happens when all games are played and scores are level. Knockouts usually use the automatic tiebreak; round robin / Swiss use "allow draws" so draws count.',
    '当前「平局处理」是「自动加赛决胜局（推荐）」，只有把平局处理改成「允许平局（平局即最终结果）」后才可能出现平局，本项届时才生效。':
      'Draw handling is currently "automatic tiebreak"; draws can only happen after switching to "allow draws".',
    '· 不勾选（默认）：平局照常按「平局分」计入，双方各记一场平。':
      '· Unchecked (default): draws count by their own points, both sides get one draw.',
    '勾选后，本阶段出现的任何平局都不分胜负、双方各记一负': 'When on, every draw counts as a loss for both sides',
    '自动配对：积分相近者优先、尽量避免重复交手；随机配对：每轮重新抽签；手动编排：生成轮次时由你在「③ 对阵与录入」页自己点选配对。三种方式都可以在生成后、录成绩前再手动微调。':
      'Auto: similar scores first, rematches avoided. Random: redraw each round. Manual: you pick pairings on the "③ Matches" page. All three can be tweaked before recording results.',
    '先赢够该局数即结束这一场（剩余局不再进行）。填 0 表示不论赢几局都打满全部局数，最后按赢局多少判定。':
      'The match ends once a side reaches this many games (remaining games are skipped). 0 = always play every game and decide by games won.',
    '填 1 = 不分回合（与以前完全一样）。填 3 就是「三场（每场3局）决出这场胜负」。':
      '1 = no sets (classic). 3 = best-of-3 sets, each with its own games.',
    '若某个阶段需要不同的局制（例如小组赛 BO1、淘汰赛 BO5），在该阶段的「本阶段局制与记分」中勾选独立设置。':
      'Need a different format for one stage (BO1 groups, BO5 knockout)? Tick "Custom" in that stage.',
    '注意：当前按整站计分，这里的给分方式要等「计分单元」改成「站内每个阶段各算一次」后才会生效。':
      'Note: scoring is currently per event; these values apply after you switch "scoring unit" to "once per stage".',
    '指定某一轮结束后，只保留排名前 N 名，其余人立即退出本阶段。与上面的「按战绩自动判定」可以同时使用。':
      'After the chosen round, only the top N remain; everyone else leaves the stage. Works together with the automatic decision above.',
    '同分时从上到下依次比较。点「上」「下」调整优先级，点「移除」停用该项，不需要的依据都可以删掉。':
      'Ties are compared top to bottom. Use Up / Down to reorder, Remove to disable.',
    '从 0 开始计数：填 0 = 第 1 轮结束后裁人。': 'Counts from 0: 0 = cut after round 1.',
    '某一场打完、满足上面的胜负条件，这一场团体赛就直接出结果（和个人赛结算一样，后面所有统计、排名、导出都按这个结果走）。队伍和队员在「② 选手管理」里维护（每队一行，可加多名队员）。':
      'Once a match satisfies the win condition it is settled, and all stats, standings and exports follow it. Maintain teams and members under "② Players".',
    '开始计时': 'Start',
    '完成本轮': 'Finish round',
    '— 选队员 —': '— pick member —',
    '归零': 'Reset',
    '选手名below一行是Live record：胜 / 负 / 平 · 本阶段积分 · 当前名次（含本轮已录入的结果，录完即刻刷新）；进行中的比赛只更新比分，分出胜负后才计入战绩与积分；已提前晋级 / 已淘汰会加标记。':
      'The line under each name is the live record: W / L / D · stage points · current rank (updates as you record). Unfinished matches only update the score; clinched / eliminated players get a tag.',
    '计入小分：先比forfeit次数、再比warning次数，都是越少越靠前；不影响本场胜负。':
      'Counts in tiebreakers: forfeits first, then warnings — fewer is better. Does not change results.',
    '名次分：第1→100 / 第2~3→80 / 第4~6→65 / 第7~10→50 / 第11~16→35 / 第17~24→20，之后每名 −3，最低 5；另有 1 个阶段单独设置。分值在「赛事设置 → 赛事积分榜」里改。':
      'Rank points: 1st→100 / 2–3→80 / 4–6→65 / 7–10→50 / 11–16→35 / 17–24→20, then −3 per rank, floor 5; 1 stage has custom rules. Edit them in "Setup → Tournament points table".',
    'Seasons (有)': 'Seasons (1)'
  });
  // 注意：i18n.js 里已经建过空数组了，这里不能用 I.terms || [...]（空数组是 truthy，会吞掉词表）
  I.terms = (I.terms || []).concat([
    ['双败淘汰', 'Double elimination'],
    ['单败淘汰', 'Single elimination'],
    ['瑞士轮', 'Swiss'],
    ['循环赛', 'Round robin'],
    ['小组赛', 'Groups'],
    ['淘汰赛', 'Knockout'],
    ['总决赛', 'Grand final'],
    ['胜者组', 'Winners bracket'],
    ['败者组', 'Losers bracket'],
    ['轮空', 'bye'],
    ['动态', 'dynamic'],
    ['选手', 'player'],
    ['队伍', 'team'],
    ['阶段', 'stage'],
    ['小组', 'group'],
    ['积分', 'points'],
    ['名次', 'rank']
  ]);
  /* ============ 4. 动态句子（数字 / 选手名）走规则 ============ */
  I.rules = I.rules || [];

  function R(re, fn) { I.rules.push([re, fn]); }

  // 轮 / 名次 / 桌 / 场
  R(/^第 (\d+) 轮$/, m => 'Round ' + m[1]);
  R(/^第 (\d+) 轮 · 当前$/, m => 'Round ' + m[1] + ' · current');
  R(/^第 (\d+) 轮已录完$/, m => 'Round ' + m[1] + ' recorded');
  R(/^第 (\d+) 轮（总决赛）$/, m => 'Round ' + m[1] + ' (Grand final)');
  R(/^第 (\d+) 轮 · 总决赛 · 当前$/, m => 'Round ' + m[1] + ' · Grand final · current');
  R(/^第 (\d+) 轮 · 总决赛最新$/, m => 'Round ' + m[1] + ' · Grand final latest');
  R(/^第 (\d+) 名$/, m => '#' + m[1]);
  R(/^第 (\d+)$/, m => '#' + m[1]);
  R(/^第 (\d+) 桌$/, m => 'Table ' + m[1]);
  R(/^第 (\d+) 场$/, m => 'Match ' + m[1]);
  R(/^剩 (\d+) 人 · (\d+) 场$/, m => m[1] + ' left · ' + m[2] + ' matches');
  R(/^(\d+) 人$/, m => m[1] + ' players');
  R(/^(\d+) 队$/, m => m[1] + ' teams');
  R(/^(\d+) 分$/, m => m[1] + ' pts');
  R(/^(\d+) 场$/, m => m[1] + ' matches');
  R(/^(\d+) 轮$/, m => m[1] + ' rounds');
  R(/^(\d+) 胜 (\d+) 负 (\d+) 平$/, m => m[1] + 'W ' + m[2] + 'L ' + m[3] + 'D');
  R(/^(\d+) \/ 动态$/, m => m[1] + ' / dynamic');
  R(/^共 (\d+) 人$/, m => m[1] + ' players');
  R(/^已打 (\d+)\/(\d+) 场，当前 (\d+):(\d+)（全部打完比赢下场数）$/,
    m => m[1] + '/' + m[2] + ' boards played, now ' + m[3] + ':' + m[4] + ' (most board wins after all boards)');
  R(/^进行中 (\d+)\/(\d+) 场（(\d+):(\d+)）$/, m => 'Running ' + m[1] + '/' + m[2] + ' boards (' + m[3] + ':' + m[4] + ')');
  R(/^回合 (\d+) (\d+):(\d+)$/, m => 'Set ' + m[1] + ' ' + m[2] + ':' + m[3]);
  R(/^团体对阵 · 共 (\d+) 场$/, m => 'Team boards · ' + m[1] + ' total');

  // 名字类
  R(/^胜者：(.*)$/, m => 'Winner: ' + m[1]);
  R(/^负者 → (.+)$/, m => 'Loser → ' + I.t(m[1]));
  R(/^胜 → (.+)$/, m => 'Win → ' + I.t(m[1]));
  R(/^负 → (.+)$/, m => 'Loss → ' + I.t(m[1]));
  R(/^让 (.*) 拿下这一局$/, m => 'Give this game to ' + m[1]);
  R(/^让 (.*) 赢下第 (\d+) 场$/, m => 'Give board ' + m[2] + ' to ' + m[1]);
  R(/^(.*) 胜$/, m => m[1] + ' wins');
  R(/^胜：(.+)$/, m => 'Winner: ' + m[1]);
  R(/^(G\d+) (?:A|B) 胜 (.+)$/, m => m[1] + ' won by ' + m[2]);
  R(/^赛事：(.*)$/, m => 'Tournament: ' + m[1]);
  R(/^(.+) 的队员（(\d+) 人）$/, m => m[1] + ' members (' + m[2] + ')');
  R(/^选手列表（(\d+) 人）$/, m => 'Player list (' + m[1] + ')');
  R(/^队伍列表（(\d+) 队）$/, m => 'Team list (' + m[1] + ')');
  R(/^已有赛事（(\d+)）$/, m => 'Tournaments (' + m[1] + ')');
  R(/^已有赛季（(\d+)）$/, m => 'Seasons (' + m[1] + ')');
  R(/^第 1 阶段$/, () => 'Stage 1');
  R(/^第 (\d+) 阶段$/, m => 'Stage ' + m[1]);
  R(/^第 (\d+) 阶段（(.+)）$/, m => 'Stage ' + m[1] + ' (' + m[2] + ')');
  R(/^第 (\d+) 阶段 排名$/, m => 'Stage ' + m[1] + ' standings');
  R(/^第 (\d+) 阶段 名次（按对阵结果）$/, m => 'Stage ' + m[1] + ' final ranks (by bracket)');
  R(/^当前阶段：第 (\d+) 阶段（(.+)）$/, m => 'Current stage: Stage ' + m[1] + ' (' + m[2] + ')');
  R(/^赛事：(.*)当前阶段：第 (\d+) 阶段（(.+)）轮次：.+参赛：(.+)状态：(.+)$/,
    m => 'Tournament: ' + m[1] + ' · Stage ' + m[2] + ' (' + m[3] + ') · ' + m[4] + ' · ' + m[5]);

  // 随机种子 / 生成时间
  R(/^随机种子：(\d+)（决定抽签结果，存档后可复现）$/,
    m => 'Random seed: ' + m[1] + ' (determines the draw; reproducible from a save)');
  R(/^赛制：(.+) · 计分：(.+) · 生成时间：(.+)$/, m => 'Format: ' + I.t(m[1]) + ' · scoring: ' + I.t(m[2]) + ' · generated ' + m[3]);
  R(/^赛制：(.+) · 生成时间：(.+)$/, m => 'Format: ' + I.t(m[1]) + ' · generated ' + m[2]);
  R(/^赛制：(.+) · 计分：(.+) · 生成时间：(.+)$/, m => 'Format: ' + m[1] + ' · scoring: ' + m[2] + ' · generated ' + m[3]);

  // 顶栏摘要
  R(/^(.+) · (\d+) 名选手 · (\d+) 个阶段 · 当前：(.+)（(.+)）$/,
    m => m[1] + ' · ' + m[2] + ' players · ' + m[3] + ' stages · current: ' + I.t(m[4]) + ' (' + I.t(m[5]) + ')');
  R(/^(.+) · (\d+) 名选手 · (\d+) 个阶段$/, m => m[1] + ' · ' + m[2] + ' players · ' + m[3] + ' stages');

  // 大比分档位提示
  R(/^(\d+) 回合 × （(.+)） · 按赢下回合数定胜负$/, m => m[1] + ' sets × (' + I.t(m[2]) + ') · winner by sets won');
  R(/^(\d+) 回合 × （(.+)） · 按赢下回合数定胜负（沿用全局）$/,
    m => m[1] + ' sets × (' + I.t(m[2]) + ') · winner by sets won (global)');
  R(/^本场共 (\d+) 个回合，每个回合打 (\d+) 局（(.*)）；判定依据：(.*)。录入自动记到当前回合。$/,
    m => 'This match has ' + m[1] + ' sets, ' + m[2] + ' games each (' + I.t(m[3]) + '); decided by ' + I.t(m[4]) + '. Entries go to the current set.');
  R(/^nvn 同时进行：还要排好剩下 (\d+) 场的上场队员，才能录成绩.每场打 (\d+) 局，先赢 (\d+) 局$/,
    m => 'nvn runs in parallel: line up the remaining ' + m[1] + ' boards before recording. Each board is ' + m[2] + ' games, first to ' + m[3]);

  /* ============ 5. 长句 / 说明文字（被 <b> 拆开的整句）============ */
  Object.assign(I.dict, {
    '开启后参赛单位变成队伍（每队若干队员），对阵与排名都按队伍计算。':
      'Turn this on and teams become the unit; matches and standings are computed per team.',
    '队伍没维护队员时用这个数兜底；正常以「选手管理」里实际的队员为准。':
      'Fallback size when a team has no members; the real members in "Players" win.',
    '晋级保证：提前晋级者无论用「按人数」还是「按积分线」晋级，都会进入下一阶段。':
      'Clinch bonus: whoever clinches early advances regardless of the "top N" or "points line" rule.',
    '· 小分不受影响：赢局 / 输局 / 净胜局 / 净小分 / 累进分仍按真实比分记录；':
      '· Scores unaffected: games won/lost, game diff, score diff and progressive score still follow real results.',
    '当前生效：每场 3 局 · 先赢 2 局 · 胜负平积分（胜 3 / 平 1 / 负 0 / 轮空 3）':
      'In effect: 3 games · first to 2 · win/draw/loss points (W3 / D1 / L0 / bye 3)',
    '当前按整站算一次：名次取整站最终排名。想让每个阶段各拿一次分，把上面「计分单元」改成「站内每个阶段各算一次」。':
      'Currently scored once for the whole event using the final ranking. To score each stage, change "scoring unit" to "once per stage".',
    '勾「晋级」= 在积分榜上把这些名次画成晋级线内（只是标注）；要按晋级真正给分，用下面的「按是否晋级下一阶段给分」。':
      '"Advance" only marks these ranks as inside the advancement line; to award points for advancing, use "by advancing to the next stage" below.',
    '每一档覆盖一段名次（如「第 2~3 名」），同档同分。没被任何一档覆盖的名次，按下面「每降 1 名扣」从上一个档位递减。':
      'Each tier covers a rank range (e.g. 2nd–3rd) with the same points. Ranks outside every tier step down from the last tier by "points per rank".',
    '达到 N 胜即提前锁定下一阶段席位（本阶段不再参赛）；达到 N 负即提前淘汰。每轮成绩全部录入后自动判定，可随时在「排名」页看到结果。':
      'N wins clinches a seat in the next stage (no more play here); N losses eliminates. Decided after each round, visible in "Standings".',
    '排序规则：已提前晋级者整体排在未定者之前（同为提前晋级时，越早锁定越靠前）；已提前淘汰者整体排在最后（同为提前淘汰时，越晚出局越靠前）。':
      'Ordering: clinched players rank above undecided ones (earlier clinch first); eliminated players go last (later elimination first).',
    '对手分照样会变：提前晋级 / 淘汰的选手不再出场，但仍保留在排行榜里，其对手分按对手的实时积分重算，所以对手后面继续赢分，他的对手分也会跟着涨。':
      'Buchholz still moves: clinched / eliminated players stay in the table and their Buchholz follows opponents\' live points.',
    '到点结算的比赛会被标记为未打完：计分走「记分规则 → 按大比分逐档设分 → 未打完」那张表，排名按实际胜负（或平局）计入战绩，场次与小分都按已打的局照常统计。':
      'Matches settled at timeout are marked unfinished: points come from the "unfinished" tier, standings count the actual result, and games / scores count as played.',
    '只在「赛事设置 → 赛事积分榜 → 计分单元 = 站内每个阶段各算一次」时生效。选「不叠加」时，晋级到本阶段的选手只拿本阶段这一笔分，之前阶段的分数不带过来。':
      'Only applies when "scoring unit = once per stage". With "no stacking", advancing players start this stage with only its own points.',
    '「第 N 阶段得分」可以每个阶段单独作为一个依据（后面的阶段都能用它比），「上一阶段得分」则固定指向上一个阶段；判负 / 警告次数越少越靠前，默认顺序是先比判负、再比警告。':
      '"Stage N points" can be added per stage; "previous stage points" always means the stage before. Fewer forfeits / warnings rank higher, forfeits first.',
    '在这里定义这场赛事怎么给分（按名次 / 按胜场 / 按是否晋级，可以细到每个阶段单独设）。「排名」页会直接出现本赛事积分榜；赛季页只负责把各站的分数加起来，不再单独设分值。':
      'Define how this event awards points (by rank / by wins / by advancing; per stage if you like). The standings page shows this table; seasons just add stops together.',
    '轮空由系统自动判定：生成轮次时按上面规则直接排好，并按记分规则里的「轮空分」自动计分，不需要人工指定。若对某轮轮空人选不满意，可在「③ 对阵与录入 → 手动编排 / 随机抽签」里改。':
      'Byes are automatic: applied by the rule above when a round is generated and scored with the bye points. Adjust one in "③ Matches → Arrange manually".',
    '举例：5 轮制、晋级线 3 胜、基础加分 2、每提前一轮 +1。第 3 轮拿到第 3 胜 → 提前 2 轮 → 下一阶段起手 +4（2 + 1×2）。加分只写入下一阶段，不改选手的全局初始分。':
      'Example: 5 rounds, clinch at 3 wins, base bonus 2, +1 per round early. A 3rd win in round 3 is 2 rounds early → +4 (2 + 1×2) in the next stage. Bonus only affects that stage.',
    '勾选后，本阶段出现的任何平局都不按平局计分，而是双方各记一负（两人都拿「负场分」，战绩表里不会再出现「平」这一项）。积分榜、导出表、提前晋级 / 提前淘汰的判定都按「双方都输」来算，相当于这场谁也没赢；':
      'When on, every draw counts as a loss for both sides (both get the loss points; no "draw" column). Points tables, exports and clinch / elimination all treat it as both losing.',
    '某个阶段的给分方式跟赛事默认不同（例如小组赛按胜场、淘汰赛按名次、资格赛按是否晋级），在这里给它单独一套规则。注意：当前按整站计分，这里的给分方式要等「计分单元」改成「站内每个阶段各算一次」后才会生效。':
      'Stages often score differently (groups by wins, knockout by rank, qualifiers by advancing). Give one its own rules here. Note: with event-wide scoring, these apply after switching to per-stage units.',
    '导出直接生成文件，不经过打印机；JPG 是整张长图，可直接发群 / 发动态。':
      'Exports are generated directly as files — no printer. A JPG is one long image, ready to share.',
    '浏览器里会直接下载到默认下载目录。 完整报告里，淘汰赛阶段会输出对阵图，其余阶段输出排名表。':
      'In a browser it downloads to the default folder. The full report draws knockout brackets and standings tables for other stages.',
    '组内循环赛：自动配对按积分、手动编排需按组分别点选配对（每组都是独立的一轮）。':
      'Group round robin: auto-pairing follows points; manual pairing is done group by group (each group is its own round).',
    '警告 / 判负计入小分：先比判负次数、再比警告次数，都是越少越靠前；不影响本场胜负。':
      'Warnings / forfeits count in tiebreakers: forfeits first, then warnings — fewer is better. Doesn\'t change results.',
    '每场对局都是下面「局制」里的 3 局（先赢 2 局），团体赛的大比分 = 赢下的场数。':
      'Every board uses the format below (3 games, first to 2); the team match score = boards won.',
    '团体赛里这项不生效：团体赛的大比分 = 上场场数（赢下几场），这里的回合数只对个人赛生效。':
      'No effect in team events: the match score is boards won, so "sets" only applies to individual play.',
    '填 0 = 报名的人都上。队员不一定等于上场人数：填 3 就只上 3 个人，第 4 人这场不打。':
      '0 = everyone plays. Members may exceed the number fielded: 3 means three play and the 4th sits out.',
    '当前阶段是淘汰赛，导出格式为对阵图（含胜者组 / 败者组 / 总决赛分区与晋级路径），底部附名次小结。':
      'This stage is a knockout: the export is a bracket (winners / losers / grand final with paths) plus a rank summary.',
    '当前生效：3 回合 × （每场 3 局 · 先赢 2 局） · 按赢下回合数定胜负 · 胜负平积分（胜 3 / 平 1 / 负 0 / 轮空 3）':
      'In effect: 3 sets × (3 games, first to 2) · winner by sets · win/draw/loss points (W3 / D1 / L0 / bye 3)',
    '自动配对：积分相近者优先、尽量避免重复交手；随机配对：每轮重新抽签；手动编排：每轮由你在「③ 对阵与录入」页自己点选配对（不再一次性生成全部轮）。':
      'Auto: similar scores first, rematches avoided. Random: redraw each round. Manual: pick pairings yourself on "③ Matches" (rounds are no longer generated all at once).',
    '半区互换已开启：上半区胜者组的败者交叉掉进下半区败者组、下半区胜者组的败者掉进上半区败者组；两个半区的败者组各自决出冠军后，先打一场败者组交叉决赛，胜者才进总决赛。':
      'Crossover on: upper-half winners-bracket losers drop into the lower losers bracket and vice versa; the two losers champions meet in the crossover final before the grand final.',
    '胜者组某半区的败者，交叉掉入另一个半区的败者组': 'Winners-bracket losers cross into the other half\'s losers bracket',
    '· 胜者组平局 → 两人一起掉进败者组；': '· Draw in winners → both drop to losers;',
    '· 败者组平局 → 两人各自吃到第 2 负，双双淘汰；': '· Draw in losers → both take a second loss and are eliminated;',
    '· 总决赛平局 → 胜者组冠军是第 1 负（掉进败者组）、败者组冠军已是第 2 负当场淘汰，场上只剩一人，即本阶段冠军；':
      '· Draw in the grand final → winners champion takes a first loss, losers champion is out; the survivor is the stage champion;',
    '勾选后，本阶段出现的任何平局都不分胜负、双方各记一负：': 'When on, every draw counts as a loss for both sides:',
    '一桌 = 一场比赛：一场团体赛由若干场对局组成，每场双方各派一名队员（可以每场都换人，同一场不能重复上）。录入顺序是先定人、再录成绩：n 对 n 是同时进行的，必须先把整场所有对局的对阵都排好，才允许录任何一场的成绩。':
      'One table = one match: a team match has several boards, each with one player per side (swap freely, no repeats within a board). Line up first, then record — nvn runs all boards in parallel, so every board must be lined up first.',
    '选手名下方一行是实时战绩：胜 / 负 / 平 · 本阶段积分 · 当前名次（含本轮已录入的结果，录完即刻刷新）；进行中的比赛只更新比分，分出胜负后才计入战绩与积分；已提前晋级 / 已淘汰会加标记。':
      'The line under each name is the live record: W / L / D · stage points · current rank (updates as you record); unfinished matches only update the score; clinched / eliminated players are tagged.',
    '读法：每一格都写清了选手或来源——灰字斜体是还没打出来的格子，例如「第 1 轮 第 2 场胜者」「胜者组第 1 轮 第 3 场败者」「败者组第 2 轮 第 1 场胜者」。卡片顶部是场次编号，底部两行是晋级路径：胜 → 下一场在哪，负 → 掉到哪（「淘汰」表示没有下一场）。双败的总决赛在最右边，与胜者组同一行。总决赛为「加赛制」：败者组冠军要先赢下首场，再赢一场加赛才能夺冠。':
      'How to read it: every cell names a player or a source — grey italics mean not decided yet (e.g. "winner of W1 M2"). The card header is the match number; the bottom two lines are the paths: win → next match, lose → where you drop ("eliminated" = nothing left). The grand final sits on the right, on the winners row. With the reset rule the losers champion must win the first match and then the reset.',
    '胜负条件：双方同时开打，所有场次一次打完再比赢下的场数，多者胜 —— 比分可能是 n:0、n−1:1 …… 有平局时还会是平局。':
      'Win condition: all boards play at once, then compare boards won — scores like n:0 or n−1:1, possibly a draw.',
    '从后续阶段开始：把某个选手的「起始阶段」设成第 2 阶段，他就不参加第 1 阶段，直接从第 2 阶段打起（种子 / 直邀 / 上届前四常用）。这一列改完立即生效，下一阶段生成名单时自动带上。':
      'Late entry: set a player\'s "start stage" to 2 and they skip stage 1 (common for seeds / invites). Takes effect immediately and shows up in the next stage\'s list.',
    '计入小分：先比判负次数、再比警告次数，都是越少越靠前；不影响本场胜负。':
      'Counts in tiebreakers: forfeits first, then warnings — fewer is better. Does not change results.',
    '团体赛：一桌 = 一场比赛，一场团体赛由若干场对局组成，每场双方各派一名队员（可以换不同的人）；大比分 = 赢下的场数；场内的局分只计入「累计小分 / 净小分」这类破同依据。':
      'Team event: one table = one match, made of several boards, each with one player per side (players may change). The match score = boards won; per-board games only feed tiebreakers such as cumulative / score difference.',
    '提前晋级 / 提前淘汰已启用：达到 3 场 即提前晋级；未设淘汰线。':
      'Early clinch / elimination on: 3 wins clinches early; no elimination line set.'
  });
  // ---- 卡片行 / 阶段摘要这类拼接（数字 + 文字）----
  R(/^(\d+) 胜 (\d+) 负 (\d+) 平(\d+) 分第 (\d+) 名$/, m => m[1] + 'W ' + m[2] + 'L ' + m[3] + 'D · ' + m[4] + ' pts · #' + m[5]);
  R(/^(\d+) 胜 (\d+) 负 (\d+) 平$/, m => m[1] + 'W ' + m[2] + 'L ' + m[3] + 'D');
  R(/^第 (\d+) 阶段(瑞士轮|循环赛|小组赛|双败淘汰|单败淘汰) · (.+)$/, m => 'Stage ' + m[1] + ' ' + I.t(m[2]) + ' · ' + I.t(m[3]));
  R(/^第 (\d+) 阶段(瑞士轮|循环赛|小组赛|双败淘汰|单败淘汰)$/, m => 'Stage ' + m[1] + ' ' + I.t(m[2]));
  R(/^第 (\d+) 阶段单独设置 · 按名次$/, m => 'Stage ' + m[1] + ' custom · by rank');
  R(/^赛事积分榜按名次 · 整站一次$/, () => 'Points table by rank · whole event');
  R(/^淘汰赛单败淘汰 · 单败（含季军赛）$/, () => 'Knockout single elimination · with 3rd place');
  R(/^当前选择：(.+) · 全部轮次（共 (\d+) 轮）$/, m => 'Selected: ' + I.t(m[1]) + ' · all rounds (' + m[2] + ')');
  R(/^当前选择：(.+) · 全部轮次$/, m => 'Selected: ' + I.t(m[1]) + ' · all rounds');
  R(/^回合 (\d+) (\d+):(\d+)回合 (\d+) (\d+):(\d+)回合 (\d+) (\d+):(\d+)$/,
    m => 'Set ' + m[1] + ' ' + m[2] + ':' + m[3] + ' · Set ' + m[4] + ' ' + m[5] + ':' + m[6] + ' · Set ' + m[7] + ' ' + m[8] + ':' + m[9]);
  R(/^本阶段局制：(.*)本阶段记分：(.*)每轮配对：(.*)$/, m => 'Stage format: ' + I.t(m[1]) + ' · scoring: ' + I.t(m[2]) + ' · pairing: ' + I.t(m[3]));
  R(/^本阶段局制：(.*)本阶段记分：(.*)首轮编排：(.*)$/, m => 'Stage format: ' + I.t(m[1]) + ' · scoring: ' + I.t(m[2]) + ' · first round: ' + I.t(m[3]));
  R(/^本阶段局制：(.*)本阶段记分：(.*)$/, m => 'Stage format: ' + I.t(m[1]) + ' · scoring: ' + I.t(m[2]));
  R(/^当前生效：(.*)$/, m => 'In effect: ' + I.t(m[1]));
  R(/^本阶段局制：(.*)$/, m => 'Stage format: ' + I.t(m[1]));
  R(/^本阶段记分：(.*)$/, m => 'Stage scoring: ' + I.t(m[1]));
  R(/^每轮配对：(.*)$/, m => 'Pairing: ' + I.t(m[1]));
  R(/^首轮编排：(.*)$/, m => 'First round: ' + I.t(m[1]));
  R(/^参赛：(\d+) 人$/, m => 'Players: ' + m[1]);
  R(/^状态：(.+)$/, m => 'Status: ' + I.t(m[1]));
  R(/^比分:$/, () => 'Score:');
  R(/^(\d+:\d+)限时 (\d+:\d+)$/, m => 'Time ' + m[2]);
  R(/^(\d+) (累进分（每轮后积分累加）|对手分总和 \(Buchholz\)|净小分（累计小分 − 对手小分）|判负次数（越少越靠前）|警告次数（越少越靠前）|胜场数|净胜局数|赢下局数|累计小分|手动指定|初始种子序|相互胜负关系|上一阶段得分|输掉局数（越少越靠前）)$/,
    m => m[1] + '. ' + I.t(m[2]));
  R(/^(胜者组|败者组|总决赛|加赛局|胜者组半决赛|胜者组决赛|败者组决赛)剩 (\d+) 人 · (\d+) 场$/,
    m => I.t(m[1]) + ' — ' + m[2] + ' left · ' + m[3] + ' matches');
  R(/^总决赛加赛制：败者组冠军需赢两场$/, () => 'Grand final uses the reset rule: losers champion must win twice');
  R(/^加赛局仅当败者组冠军赢下首场才进行$/, () => 'Reset match only if the losers champion wins the first one');
  R(/^胜者 → 夺冠（无后续比赛）负者 → 亚军$/, () => 'Win → champion (no further match) · Loss → runner-up');
  // ---- 第二层：残留的具体写法（补到 EN 检查归零为止）----
  R(/^第 (\d+) 轮最新$/, m => 'Round ' + m[1] + ' (latest)');
  R(/^第 (\d+) 轮 · 当前$/, m => 'Round ' + m[1] + ' · current');
  R(/^第 (\d+) 轮已录完$/, m => 'Round ' + m[1] + ' recorded');
  R(/^第 (\d+) 阶段(.+)$/, m => 'Stage ' + m[1] + ' ' + I.t(m[2]));
  R(/^(\d+) 组 · (循环赛|瑞士轮|单败淘汰|双败淘汰)$/, m => m[1] + ' groups · ' + I.t(m[2]));
  R(/^(\d+) 循环$/, m => m[1] + (m[1] === '1' ? ' cycle' : ' cycles'));
  R(/^(\d+) 轮$/, m => m[1] + ' rounds');
  R(/^任何平局都判为\s*(.+)$/, m => 'Every draw counts as ' + I.t(m[1]));
  R(/^(\d+)\.\s*(.+)$/, m => m[1] + '. ' + I.t(m[2]));
  R(/^(\d+) 人$/, m => m[1] + ' players');
  R(/^先赢 (\d+) 局$/, m => 'first to ' + m[1]);
  R(/^赢下回合数（先赢 (\d+) 回合）$/, m => 'sets won (first to ' + m[1] + ')');
  R(/^(\d+) 场$/, m => m[1] + ' matches');
  R(/^(\d+) 胜 (\d+) 负$/, m => m[1] + 'W ' + m[2] + 'L');
  R(/^胜者组某半区的败者，交叉掉入(.+)半区的败者组$/, m => 'Winners-bracket losers cross into the ' + I.t(m[1]).toLowerCase() + ' half\'s losers bracket');
  // ---- 双败 / 淘汰赛的轮次标签（"败者组第 2 轮 第 1 场" 这类全靠规则拼）----
  R(/^胜者组第 (\d+) 轮$/, m => 'Winners round ' + m[1]);
  R(/^败者组第 (\d+) 轮$/, m => 'Losers round ' + m[1]);
  R(/^胜者组第 (\d+) 轮 第 (\d+) 场$/, m => 'Winners R' + m[1] + ' M' + m[2]);
  R(/^败者组第 (\d+) 轮 第 (\d+) 场$/, m => 'Losers R' + m[1] + ' M' + m[2]);
  R(/^胜者组半决赛$/, () => 'Winners semifinal');
  R(/^胜者组半决赛 第 (\d+) 场$/, m => 'Winners SF' + m[1]);
  R(/^胜者组决赛 第 (\d+) 场$/, m => 'Winners final M' + m[1]);
  R(/^败者组决赛 第 (\d+) 场$/, m => 'Losers final M' + m[1]);
  R(/^总决赛 第 (\d+) 场$/, m => 'Grand final M' + m[1]);
  R(/^加赛局 第 (\d+) 场$/, m => 'Reset match M' + m[1]);
  R(/^第 (\d+) 阶段 · 全部轮次$/, m => 'Stage ' + m[1] + ' · all rounds');
  R(/^淘汰赛 · 全部轮次$/, () => 'Knockout · all rounds');

  // ---- 导出报表里的标题（带赛事名）----
  R(/^(.+) · 淘汰赛合并对阵图$/, m => m[1] + ' · merged knockout bracket');
  R(/^(.+) · 第 (\d+) 阶段 排名$/, m => m[1] + ' · Stage ' + m[2] + ' standings');
  R(/^(.+) · 第 (\d+) 阶段 对阵表$/, m => m[1] + ' · Stage ' + m[2] + ' matches');
  R(/^本赛事只有 (\d+) 个淘汰赛阶段，无需合并。\s*生成时间：(.*)$/,
    m => 'Only ' + m[1] + ' knockout stage — nothing to merge. Generated ' + m[2]);

  // ---- 局制 / 记分摘要（含「沿用全局」后缀）----
  R(/^每场 (\d+) 局 · 先赢 (\d+) 局$/, m => m[1] + ' games per match · first to ' + m[2]);
  R(/^每场 (\d+) 局 · 先赢 (\d+) 局（沿用全局）$/, m => m[1] + ' games per match · first to ' + m[2] + ' (global)');
  R(/^胜负平积分（胜 (\d+) \/ 平 (\d+) \/ 负 (\d+) \/ 轮空 (\d+)）$/, m => 'Win ' + m[1] + ' / draw ' + m[2] + ' / loss ' + m[3] + ' / bye ' + m[4]);
  R(/^胜负平积分（胜 (\d+) \/ 平 (\d+) \/ 负 (\d+) \/ 轮空 (\d+)）（沿用全局）$/,
    m => 'Win ' + m[1] + ' / draw ' + m[2] + ' / loss ' + m[3] + ' / bye ' + m[4] + ' (global)');
  R(/^限时 (\d+:\d+)$/, m => 'Time ' + m[1]);
  R(/^随机种子：(\d+)（决定抽签结果，存档后可复现）$/, m => 'Random seed: ' + m[1] + ' (determines the draw; reproducible from a save)');
  // 积分榜摘要
  R(/^当前：已提前晋级 (\d+) 人 · 已淘汰 (\d+) 人 · 仍待定 (\d+) 人。$/,
    m => 'Now: ' + m[1] + ' clinched · ' + m[2] + ' eliminated · ' + m[3] + ' undecided.');
})(window);
