/**
 * 路径定义（所有脚本共用）
 * ---------------------------------------------------
 * build/ 这个工具目录**不在站点里面**，它在工作区根下和站点平行放着。
 * 这是故意的：免得构建脚本、测试、node_modules 跟着网站一起被传上去。
 *
 * 所以这里不能用简单的 `..` 反推站点位置，必须显式写。
 * 目录结构如果又变了，只改这一个文件。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** build/ 目录本身 */
export const buildDir = path.dirname(fileURLToPath(import.meta.url));

/** 站点根：index.html、sk.json、p/、Skills/ 都在这下面 */
export const siteRoot = path.resolve(buildDir, '..', 'jinsuper.rth1.xyz');

/** 文档页所在目录 */
export const pDir = path.join(siteRoot, 'p');

/** 模板目录（页面源码在这里改） */
export const templateDir = path.join(buildDir, 'template');

/** 常用文件的绝对路径 */
export const paths = {
  sk: path.join(siteRoot, 'sk.json'),
  docsHtml: path.join(pDir, 'docs.html'),
  docsJs: path.join(pDir, 'docs-md.js'),
  docsCss: path.join(pDir, 'docs-md.css'),
  fonts: path.join(pDir, 'fonts'),
  templateHtml: path.join(templateDir, 'docs.html'),
  templateCss: path.join(templateDir, 'docs-md.css'),
  newThings: path.join(siteRoot, '.NEWTHINGS'),
};
