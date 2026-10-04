<?php
/**
 * 纯文本读取接口
 * 平台会把 .md 等文件渲染成 HTML 页面，直接 fetch 拿不到原文。
 * 本接口按网站根目录相对路径读取文本文件原文，供文档页与源码查看器使用。
 */

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');

$raw = isset($_GET['f']) ? (string)$_GET['f'] : '';
$path = str_replace('\\', '/', $raw);
$path = ltrim($path, '/');

/* 规范化路径，拒绝目录穿越 */
$segments = array();
foreach (explode('/', $path) as $seg) {
    if ($seg === '' || $seg === '.') continue;
    if ($seg === '..') { http_response_code(400); echo '非法路径'; exit; }
    $segments[] = $seg;
}
$path = implode('/', $segments);

if ($path === '') { http_response_code(400); echo '缺少参数 f'; exit; }

/* 仅允许读取文本类文件 */
$allowed = array(
    'md','markdown','mdown','mkd',
    'txt','log','json','xml','yml','yaml','csv','tsv',
    'js','mjs','cjs','ts','tsx','jsx','vue','svelte',
    'css','scss','sass','less','styl',
    'py','rb','go','rs','java','c','cpp','h','hpp','cs','php',
    'swift','kt','sh','bash','zsh','fish','sql','toml','ini','conf',
    'html','htm','xhtml','svg'
);

$ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
if (!in_array($ext, $allowed, true)) {
    http_response_code(403);
    echo '不支持的文件类型';
    exit;
}

if (!file_exists($path) || !is_file($path) || !is_readable($path)) {
    http_response_code(404);
    echo '找不到文件';
    exit;
}

$content = file_get_contents($path);
if ($content === false) {
    http_response_code(500);
    echo '读取失败';
    exit;
}

echo $content;
