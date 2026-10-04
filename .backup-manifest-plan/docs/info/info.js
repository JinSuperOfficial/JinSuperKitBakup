/* ═══════════════════════════════════════════════════════
   /docs/info/info.js
   01 目录树   02 图标索引   03 说明（静态）
   ═══════════════════════════════════════════════════════ */

const $ = (s, r = document) => r.querySelector(s);

/* ── 通用：复制 + 提示 ── */
async function copyText(text, tip){
  try{
    await navigator.clipboard.writeText(text);
    toast(tip || '已复制');
  }catch{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try{ document.execCommand('copy'); toast(tip || '已复制'); }
    catch{ toast('复制失败', true); }
    document.body.removeChild(ta);
  }
}

let toastTimer = null;
function toast(msg, isErr){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', !!isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1700);
}

const esc = s => String(s).replace(/[&<>"]/g,
  c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));

/* ═══════════════════════════════════════════════════════
   01 · 目录树
   ═══════════════════════════════════════════════════════ */

const TREE = {
  name:'/', dir:true, desc:'网站根目录', open:true, children:[

    { name:'404.html', desc:'404 错误页「所寻之处，一切皆空」，含返回 /Skills/ 的按钮' },
    { name:'robots.txt', desc:'爬虫规则：放行 GPTBot / ClaudeBot 抓 /p/，其余全站允许；指向 sitemap' },
    { name:'sk.json', desc:'根级映射表：HOMEWORK-TEMP / skills / reference 三个别名' },
    { name:'skills.json', desc:'空文件 —— 根级旧清单，目前无内容，且未被任何页面引用' },

    { name:'asset/', dir:true, desc:'设计素材：图标、配色方案与技能文档', children:[
      { name:'SKILL.md', desc:'better-theme 技能文档：反主流美学的设计规范（配色 / 布局 / 文案）' },
      { name:'color-theme.md', desc:'配色库：21 组调色板，覆盖暖调大地 / 冷调自然 / 传统文化 / 现代极简 / 2026 趋势' },
      { name:'功能.md', desc:'better-interaction 技能：滚动驱动、指针响应、微交互与动效规范' },
      { name:'icon/', dir:true, desc:'598 枚 Ant Design 官方 SVG 图标 + 版权说明', children:[
        { name:'home.svg', desc:'示例图标 · 主页' },
        { name:'Function.svg', desc:'示例图标 · 函数' },
        { name:'集合基本信息.txt', desc:'图标集合来源：iconfont cid=9402，整理者「竹尔」，非原创' },
        { name:'作者主页-竹尔.url', desc:'指向图标整理者主页的快捷方式' },
        { name:'…… 其余 595 枚', desc:'完整清单见本页「02 图标索引」', ghost:true }
      ] }
    ] },

    { name:'811/', dir:true, desc:'八年(11)班专区：作业、课程表与工具入口', children:[
      { name:'index.html', desc:'811 工具箱：作业 / 课程表入口，页脚链回百宝箱与工具站' },
      { name:'homework.html', desc:'今日份美味作业：读 data/homework.json 渲染每日清单，带完成进度与色调系统' },
      { name:'classtable.html', desc:'课程表 · 811班：基础版 / 缩略版两套，可切完整课表与今日课程' },
      { name:'data/', dir:true, desc:'作业数据', children:[
        { name:'homework.json', desc:'作业数据：按科目键 + 特殊字段「笔记」' }
      ] }
    ] },

    { name:'Skills/', dir:true, desc:'工具站主目录：索引、清单、源码查看器', children:[
      { name:'index.html', desc:'目录页：读 skills.json 渲染列表，带搜索、面包屑、自定义右键菜单' },
      { name:'skills.json', desc:'工具清单：11 条 items，按 canvas → demo → doc → tool 分组' },
      { name:'viewer.html', desc:'源码查看器：viewer.html?f=路径 高亮并查看任意页面源码' },
      { name:'data/', dir:true, desc:'空目录（作业数据已迁往 /811/data）', children:[] },

      { name:'standalone/', dir:true, desc:'独立小应用', children:[
        { name:'function.html', desc:'函数显示器：画函数 / 隐式 / 极坐标 / 参数方程，网格吸附、六套配色、JSON 导入导出' }
      ] },
      { name:'docs/', dir:true, desc:'文档类页面与说明', children:[
        { name:'docs.html', desc:'文档站：跳转页 → /p/docs.html' },
        { name:'blog.html', desc:'BLOG：跳转页 → /p/' },
        { name:'备注.txt', desc:'kind 内置值说明：canvas / color / demo / doc / game / tool 的图标与适用场景' }
      ] },
      { name:'tools/', dir:true, desc:'工具', children:[
        { name:'homework-static.html', desc:'作业页静态版：历史版本，读同一份 /811/data/homework.json' },
        { name:'htmlview.html', desc:'HTML 在线运行：三栏编辑器，HTML / CSS / JS 分标签，实时预览与控制台' },
        { name:'speedtest.html', desc:'服务器性能测试：本机跑分 + 网络测速（延迟 / 抖动 / 下载 / 上传）' },
        { name:'test_html_20260919_d04d4f.html', desc:'单摆计算器：周期 T 与摆长 l 任一互算' }
      ] },
      { name:'idea/', dir:true, desc:'创意 / 试验页（暂未列入清单）', children:[
        { name:'moont.html', desc:'月相演示器：三个视角看懂月球阴影' },
        { name:'tihu.html', desc:'海风骑行日 · 鹈鹕的自行车：纯 SVG 动画，IK 反解腿部' },
        { name:'PelicanTest.html', desc:'与 tihu.html 内容基本相同的另一版本' }
      ] }
    ] },

    { name:'p/', dir:true, desc:'文章 / 文档区', children:[
      { name:'index.html', desc:'para/ — 写点什么：文章列表页（BLOG 的实际入口）' },
      { name:'docs.html', desc:'文档页，含 sk.json 清单读取逻辑' },
      { name:'SKILL.md', desc:'better-theme 技能文档副本' },
      { name:'color-theme.md', desc:'配色方案库副本' },
      { name:'temp-homework.md', desc:'临时文件：英语作文题（家用机器人），尚未接入作业页' },
      { name:'TEST.md', desc:'测试文件，内容仅 sss / # a' },
      { name:'para/', dir:true, desc:'文章源文件', children:[
        { name:'First.md', desc:'首页欢迎文案：811-Studio 署名与说明' }
      ] }
    ] },

    { name:'old/', dir:true, desc:'历史归档', children:[
      { name:'index.html', desc:'目录页旧版备份' },
      { name:'func-v4.html', desc:'函数显示器 旧版 V4' },
      { name:'func-v5.html', desc:'函数显示器 旧版 V5' },
      { name:'skills.json', desc:'旧版清单：仅 func-v4 / func-v5 两条' }
    ] },

    { name:'web/', dir:true, desc:'备选首页', children:[
      { name:'index.html', desc:'百宝箱：常驻读取 /Skills/skills.json，渲染成卡片网格' },
      { name:'bak.html', desc:'百宝箱旧版备份' }
    ] },

    { name:'docs/', dir:true, desc:'站点信息文档（当前页面所在）', children:[
      { name:'info/', dir:true, desc:'你正在看的页面', open:true, children:[
        { name:'index.html', desc:'站点信息页：目录地图 + 图标索引 + SVG 说明' },
        { name:'info.css', desc:'本页样式表' },
        { name:'info.js', desc:'本页脚本：目录树数据与图标清单' }
      ] }
    ] }
  ]
};

const ICO = {
  chev:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>',
  dir:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  file:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M14 3v5h5"/></svg>'
};

const treeRoot = $('#treeRoot');
const flatIndex = [];               // {node, path, el}

function renderTree(){
  treeRoot.innerHTML = '';
  const rootUl = document.createElement('ul');
  TREE.children.forEach(child =>
    rootUl.appendChild(buildNode(child, '/')));
  treeRoot.appendChild(rootUl);
}

function buildNode(node, parentPath){
  const li = document.createElement('li');
  li.className = 'node' + (node.dir ? ' is-dir' : '');
  if (node.open) li.classList.add('is-open');

  const path = parentPath + node.name;
  const row = document.createElement('div');
  row.className = 'row';
  if (node.dir) row.setAttribute('role', 'treeitem');

  row.innerHTML =
    (node.dir ? `<span class="tw">${ICO.chev}</span>` : '<span class="tw"></span>') +
    `<span class="fi">${node.dir ? ICO.dir : ICO.file}</span>` +
    `<span class="nm">${esc(node.name)}</span>` +
    `<span class="dq">${esc(node.desc || '')}</span>` +
    (node.ghost ? '' : `<button class="cp" type="button" data-path="${esc(path)}">复制</button>`);

  li.appendChild(row);

  if (node.dir && node.children && node.children.length){
    const ul = document.createElement('ul');
    node.children.forEach(c => ul.appendChild(buildNode(c, path)));
    li.appendChild(ul);

    row.addEventListener('click', e => {
      if (e.target.closest('.cp')) return;
      li.classList.toggle('is-open');
    });
  }

  flatIndex.push({ node, path, li });
  return li;
}

/* 复制按钮 */
treeRoot.addEventListener('click', e => {
  const b = e.target.closest('.cp');
  if (!b) return;
  e.stopPropagation();
  const p = b.getAttribute('data-path');
  copyText(p, '已复制 ' + p);
});

/* 筛选 + 展开收起 */
function nodeMatches(node, q){
  if (!q) return true;
  if ((node.name + ' ' + (node.desc || '')).toLowerCase().includes(q)) return true;
  return !!(node.children && node.children.some(c => nodeMatches(c, q)));
}

function applyTree(q){
  const qq = q.trim().toLowerCase();
  flatIndex.forEach(({ node, li }) => {
    const self = (node.name + ' ' + (node.desc || '')).toLowerCase().includes(qq);
    const hit = nodeMatches(node, qq);
    li.classList.toggle('is-hidden', !hit);
    if (qq && hit){
      if (node.dir) li.classList.add('is-open');
    }
  });
}

$('#treeq').addEventListener('input', e => {
  const v = e.target.value;
  clearTimeout($('#treeq')._t);
  $('#treeq')._t = setTimeout(() => applyTree(v), 90);
});

$('#treeExpand').addEventListener('click', () => {
  flatIndex.forEach(({ node, li }) => { if (node.dir) li.classList.add('is-open'); });
});
$('#treeCollapse').addEventListener('click', () => {
  flatIndex.forEach(({ node, li }) => { if (node.dir && !node.open) li.classList.remove('is-open'); });
});

renderTree();

/* ═══════════════════════════════════════════════════════
   02 · 图标索引
   ═══════════════════════════════════════════════════════ */

/* 扁平清单：/asset/icon 下全部 SVG，共 598 枚（按文件名排序） */
const ICONS = [
/* A */ '1_1','Batch_folding','CI-circle-fill','CI','CodeSandbox-circle-f','CodeSandbox-square-f','CodeSandbox','Console-SQL','Dollar-circle-fill','Dollar','EURO-circle-fill','EURO','Field-Binary','Field-String','Field-number','Field-time','Function','GIF','Gitlab-fill','Gitlab','HTML5-fill','HTML5','IE-circle-fill','IE-square-fill','IE','Import','Partition','Pound-circle-fill','Pound','QQ-circle-fill','QQ-square-fill','QQ','Report','Stored_procedure','USB-fill','USB','View','YUAN-circle-fill','YUAN','Youtube-fill','Youtube','account_book-fill','account_book','add_user','addteam','aim','alert-fill','alert','alibaba','align-center','align-left','align-right','alipay-circle-fill','alipay-square-fill','alipay','aliwangwang-fill','aliwangwang','amazon-circle-fill','amazon-square-fill','amazon','android-fill','android','ant-cloud','ant_design','apartment','api-fill','api','app_store-fill','app_store','apple-fill','apple','appstore_add','area_chart','arrawsalt','arrowdown','arrowleft','arrowright','arrowup','attachment','audio-fill','audio','audio_static','audit','backward','bank-fill','bank','bar_chart','barcode','batch_folding-fill','behance-circle-fill','behance-square-fill','behance','bell-fill','bell','bg-colors','block','bold','book-fill','book','border-bottom',
/* B */ 'border-horizontal','border-inner','border-left','border-outer','border-right','border-top','border-verticle','border','box_plot-fill','box_plot','branches','bug-fill','bug','build-fill','build','bulb-fill','bulb','calculator-fill','calculator','calendar-check-fill','calendar-check','calendar-fill','calendar','camera-fill','camera','car-fill','car','caret-down','caret-left','caret-right','caret-up','carry_out-fill','carry_out','check-circle-fill','check-circle','check-square-fill','check-square','check','chrome-fill','chrome','clear','close-circle-fill','close-circle','close-square-fill','close-square','close','cloud-download','cloud-fill','cloud-server','cloud-sync','cloud-upload','cloud','cluster','code','code_library-fill','code_library','codepen-circle-fill','codepen-square-fill','codepen','collapse','colum-height','column-width','comment','compass-fill','compass','compress','contacts-fill','contacts','container-fill','container','control-fill','control','copyright-circle-fil','copyright','credit_card-fill','credit_card','crown-fill','crown','customerservice-fill','customerservice','dash','dashboard-fill','dashboard','database-fill','database','delete-fill','delete','delete_column','delete_row','delete_team','delete_user','deployment_unit','desktop','detail-fill','detail','diff-fill','diff','dingtalk-circle-fill','dingtalk-square-fill','dingtalk',
/* C */ 'disconnect','double_right','doubleleft','down-circle-fill','down-circle','down-square-fill','down-square','down','download','drag','dribbble-circle-fill','dribbble-square-fill','dribbble','dropbox-circle-fill','dropbox-square-fill','dropbox','earth','edit-fill','edit-square','edit','ellipsis','enter','error-fill','error','exclaimination','expand','expend','experiment-fill','experiment','export','eye-close','eye-fill','eye','eye_close-fill','facebook-fill','facebook','fall','fast-backward','fast-forward','file-GIF','file-add-fill','file-add','file-copy-fill','file-copy','file-excel-fill','file-excel','file-exclamation-fil','file-exclamation','file-fill','file-image-fill','file-image','file-markdown-fill','file-markdown','file-pdf-fill','file-pdf','file-ppt-fill','file-ppt','file-text-fill','file-text','file-unknown-fill','file-unknown','file-word-fill','file-word','file-zip-fill','file-zip','file','file_-exception','file_done','file_protect','file_search','file_sync','filter-fill','filter','fire-fill','fire','flag-fill','flag','folder-add-fill','folder-add','folder-fill','folder-open-fill','folder-open','folder-view','folder','font-colors','font-size','fork','format_painter-fill','format_painter','forward','frown-fill','frown','fullscreen-exit','fullscreen','fund-fill','fund','funnel_plot-fill','funnel_plot','gateway','gift-fill',
/* D */ 'gift','github-fill','gold','golden-fill','google-circle-fill','google-square-fill','google','google_plus-circle-f','google_plus-square-f','google_plus','group','heart-fill','heart','heat_map','highlight-fill','highlight','home-fill','home','hourglass-fill','hourglass','id_card-fill','id_card','image-fill','image','indent','index','info-circle-fill','info-circle','infomation','insert_row_above','insert_row_below','insert_row_left','insert_row_right','instagram-fill','instagram','insurance-fill','insurance_','interation-fill','interation','issues_close','italic','key','laptop','layout-fill','layout','left-circle-fill','left-circle','left-square-fill','left-square','left','like-fill','like','line-height','line','line_chart','link','linkedin-fill','linkedin','location-fill','location','lock-fill','lock','login','logout','mail-fill','mail','man','medicine_box-fill','medicinebox','medium-circle-fill','medium-square-fill','medium','meh-fill','meh','menu','merge-cells','message-fill','message','minus-circle-fill','minus-circle','minus-square-fill','minus-square','minus','mobile-fill','mobile','money_collect-fill','money_collect','monitor','mr','notification-fill','notification','number','ordered_list','outdent','pause','percentage','phone-fill','phone','pic-center','pic-left',
/* E */ 'pic-right','pie_chart-circle-fil','pie_chart','play-circle-fill','play-circle','play-square-fill','play-square','plus-circle-fill','plus-circle','plus-square-fill','plus-square','plus','point_map','poweroff-circle-fill','poweroff','printer-fill','printer','project-fill','project','property_safety-fill','property_safety','pushpin-fill','pushpin','qrcode','question-circle-fill','question-circle','question','radar_chart','radius-bottomleft','radius-bottomright','radius-setting','radius-upleft','radius-upright','read-fill','read','reconciliation-fill','reconciliation','red_envelope-fill','red_envelope','reddit-circle-fill','reddit-square-fill','reddit','redo','reload','reload_time','rest-fill','rest','retweet','right-circle-fill','right-circle','right-square-fill','right-square','right','rise','robot-fill','robot','rocket-fill','rocket','rollback','rotate-left','rotate-right','safety_certificate-f','safety_certificate','save-fill','save','scan','scissor','search','security_scan-fill','security_scan','select','send','setting-fill','setting','sever-fill','sever','shake','share','shop-fill','shop','shopping-fill','shopping','shortcut-fill','shortcut','shrink','signal-fill','sisternode','sketch-circle-fill','sketch-square-fill','sketch','skin-fill','skin','skype-fill','skype','slack-circle-fill','slack-square-fill','slack','sliders-fill','sliders','small-dash',
/* F */ 'smile-fill','smile','snippets-fill','snippets','solit-cells','solution','sort-ascending','sort-descending','sound-fill','sound','star-fill','star','step-backward','step-forward','stock','stop-fill','stop','strikethrough','subnode','swap-left','swap-right','swap','switch_user','sync','table','tablet-fill','tablet','tag-fill','tag','tags-fill','tags','taobao-circle-fill','taobao-square-fill','taobao','team','thunderbolt-fill','thunderbolt','time-circle-fill','time-circle','time_out','totop','trademark-circle-fil','trademark','transaction','translate','trophy-fill','trophy','twitter-circle-fill','twitter-square-fill','twitter','underline','undo','ungroup','unlike-fill','unlike','unlock-fill','unlock','unordered_list','up-circle-fill','up-circle','up-square-fill','up-square','up','upload','user','verified','vertical-align-botto','vertical-align-middl','vertical-align-top','vertical_left','vertical_right','video-fill','video','videocamera_add','wallet-fill','wallet','warning-circle-fill','warning-circle','wechat-fill','weibo-circle-fill','weibo-square-fill','weibo','whatsapp','wifi','windows-fill','windows','woman','wrench-fill','wrench','yahoo-fill','yahoo','yuque-fill','yuque','zhihu-circle-fill','zhihu-square-fill','zhihu','zoom_in','zoom_out'
];

const CATMETA = [
  ['nav',    '导航与方向'],
  ['file',   '文件与文档'],
  ['editor', '编辑与排版'],
  ['media',  '媒体与图像'],
  ['data',   '数据与统计'],
  ['system', '系统与状态'],
  ['users',  '用户与团队'],
  ['brand',  '品牌与平台'],
  ['misc',   '通用与其他']
];

/* 品牌 / 平台：精确名单 */
const BRAND = new Set(['alibaba','alipay-circle-fill','alipay-square-fill','alipay','aliwangwang-fill','aliwangwang','amazon-circle-fill','amazon-square-fill','amazon','android-fill','android','ant-cloud','ant_design','app_store-fill','app_store','apple-fill','apple','appstore_add','behance-circle-fill','behance-square-fill','behance','chrome-fill','chrome','codepen-circle-fill','codepen-square-fill','codepen','dingtalk-circle-fill','dingtalk-square-fill','dingtalk','dribbble-circle-fill','dribbble-square-fill','dribbble','dropbox-circle-fill','dropbox-square-fill','dropbox','facebook-fill','facebook','github-fill','gitlab-fill','gitlab','google-circle-fill','google-square-fill','google','google_plus-circle-f','google_plus-square-f','google_plus','html5-fill','html5','ie-circle-fill','ie-square-fill','ie','instagram-fill','instagram','linkedin-fill','linkedin','medium-circle-fill','medium-square-fill','medium','qq-circle-fill','qq-square-fill','qq','reddit-circle-fill','reddit-square-fill','reddit','sketch-circle-fill','sketch-square-fill','sketch','skype-fill','skype','slack-circle-fill','slack-square-fill','slack','taobao-circle-fill','taobao-square-fill','taobao','twitter-circle-fill','twitter-square-fill','twitter','wechat-fill','weibo-circle-fill','weibo-square-fill','weibo','whatsapp','windows-fill','windows','yahoo-fill','yahoo','youtube-fill','youtube','yuque-fill','yuque','zhihu-circle-fill','zhihu-square-fill','zhihu','codesandbox-circle-f','codesandbox-square-f','codesandbox','ci-circle-fill','ci','usb-fill','usb']);

const RE = {
  users:  /(^user$|_user$|^add_user$|team|customerservice|contacts|^smile|^frown|^meh|^man$|^woman$|^mr$|^group$|^ungroup$|switch_user)/,
  file:   /^(file|folder|book|read|account_book|index$|attachment|snippets|code_library|detail$|detail-fill$|reconciliation|diff|audit$|report$|solution$|partition$|import$|view$|batch_folding|stored_procedure$)/,
  media:  /^(play|pause|stop|step-|fast-|sound|audio|video|videocamera|camera|image|eye|like|unlike|heart|star|message|comment|notification|bell|share|send|mail|phone|pushpin|tag|tags|filter|scissor$|highlight)/,
  editor: /^(bold$|italic$|underline$|strikethrough$|font-colors$|font-size$|line-height$|align-|unordered_list$|ordered_list$|indent$|outdent$|format_painter|edit|delete|clear$|select$|border|radius|merge-cells$|colum-height$|column-width$|insert_row|table$|pic-|drag$|block$|key$|translate$|bg-colors$)/,
  data:   /(chart|_plot|^fund|^stock$|^percentage$|^number$|^heat_map$|field-|^function$|^gateway$|^cluster$|^database|^deployment_unit$|^sisternode$|^subnode$|^branches$|^fork$|^container|^transaction$|^property_safety|^safety_certificate|^security_scan|^insurance|^money_collect|^wallet|^credit_card|^red_envelope|^gold|^golden|^gift|^console-sql$|^partition$|^stored_procedure$|^field)/,
  system: /^(setting|control|sliders|build|wrench|experiment|check|close|plus|minus|info|infomation$|question|exclaimination$|warning|error|alert|disconnect$|poweroff|scan$|qrcode$|barcode$|printer|save|wifi$|signal|thunderbolt|hourglass|calendar|time|reload_time$|bug|issues_close$|verified$|copyright|trademark|id_card|lock|unlock|sever|shake$|solution$|api)/,
  nav:    /^(arrow|caret|arrawsalt|up|down|left|right|double|swap|expand$|expend$|shrink$|compress$|enter$|login$|logout$|forward$|backward$|fall$|rise$|sort-|rollback$|undo$|redo$|retweet$|reload$|sync$|rotate-|fullscreen|menu$|totop$|upload$|download$|export$|collapse$)/
};

function catOf(n){
  const low = n.toLowerCase();
  if (BRAND.has(low))                      return 'brand';
  if (RE.users.test(low))                  return 'users';
  if (RE.file.test(low))                   return 'file';
  if (RE.media.test(low))                  return 'media';
  if (RE.editor.test(low))                 return 'editor';
  if (RE.data.test(low))                   return 'data';
  if (RE.system.test(low))                 return 'system';
  if (RE.nav.test(low))                    return 'nav';
  return 'misc';
}

const CATLBL = Object.fromEntries(CATMETA);
const counts = {};
ICONS.forEach(n => { const c = catOf(n); counts[c] = (counts[c] || 0) + 1; });

const gridEl  = $('#iconGrid');
const noneEl  = $('#iconNone');
const catEl   = $('#iconCats');
let activeCat = 'all';
let iconQuery = '';

/* 分类 chips */
catEl.innerHTML =
  `<button class="chip on" data-cat="all" type="button">全部<span class="c">${ICONS.length}</span></button>` +
  CATMETA.filter(([id]) => counts[id])
    .map(([id, label]) =>
      `<button class="chip" data-cat="${id}" type="button">${label}<span class="c">${counts[id]}</span></button>`)
    .join('');

catEl.addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  activeCat = b.dataset.cat;
  catEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b));
  renderIcons();
});

function renderIcons(){
  const q = iconQuery.trim().toLowerCase();
  const list = ICONS.filter(n =>
    (activeCat === 'all' || catOf(n) === activeCat) &&
    (!q || n.toLowerCase().includes(q))
  );

  $('#iconCount').textContent = ICONS.length;
  noneEl.hidden = list.length !== 0;

  gridEl.innerHTML = list.map(n => `
    <div class="ic" role="listitem" tabindex="0" data-name="${esc(n)}" title="${esc(n)}.svg">
      <span class="glyph"><img loading="lazy" alt="" src="/asset/icon/${encodeURIComponent(n)}.svg"></span>
      <span class="cap">${esc(n)}</span>
    </div>`).join('');
}

/* 点击复制引用 */
async function grab(el){
  const n = el.getAttribute('data-name');
  await copyText(`/asset/icon/${n}.svg`, '已复制 /asset/icon/' + n + '.svg');
}
gridEl.addEventListener('click', e => {
  const el = e.target.closest('.ic');
  if (el) grab(el);
});
gridEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.ic');
  if (el){ e.preventDefault(); grab(el); }
});

$('#iconq').addEventListener('input', e => {
  iconQuery = e.target.value;
  clearTimeout($('#iconq')._t);
  $('#iconq')._t = setTimeout(renderIcons, 90);
});

renderIcons();
