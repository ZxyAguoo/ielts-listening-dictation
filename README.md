# 雅思听力考点词听写

这是公开的 GitHub Pages 发布仓库。网站代码和内置初始词库会公开，但用户的错题、自定义词书、听写记录、主题及当前进度只保存在各自浏览器的 `localStorage` 中，不会提交到 GitHub。

## 自动发布

仓库的 `main` 分支每次收到新提交时，`.github/workflows/pages.yml` 会自动把 `site/` 发布到同一个 GitHub Pages 地址。首次建立仓库后，在 GitHub 的 `Settings -> Pages -> Build and deployment` 中选择 `GitHub Actions`。

日常更新流程：

```powershell
node E:\1雅思\tools\listening_v3\build-github-release.mjs
git add .
git commit -m "Update listening dictation app"
git push
```

网站会在启动、重新获得焦点以及定时间隔检查 `version.json`。检测到新版时会先保存当前输入，再提示用户刷新；进行中的听写不会被强制中断。

## 本地数据

- 更新网页代码不会清除同一网址、同一浏览器中的学习数据。
- 数据不会自动跨浏览器或跨设备同步。
- 从本地 HTML 首次迁移到 GitHub Pages 时，应在旧版中导出备份，再在网页中导入一次。
- 更换 GitHub 仓库名或域名会形成新的浏览器存储来源，也需要手动导入备份。

## Mac 英式发音

网页按 `en-GB` 语言标签选择当前设备提供的英式声音，不绑定 Microsoft 语音名称。Mac 会显示 Safari 或 Chrome 可读取到的 Apple/macOS 英式声音。

若没有英式声音，请在 Mac 的以下位置添加后完全退出并重开浏览器：

`系统设置 -> 辅助功能 -> 朗读与语音 -> 系统声音 -> 添加声音 -> English (UK)`

## 发布边界

发布目录只包含 `site/` 的静态网页文件、部署工作流、说明和校验清单。构建脚本不会复制个人备份、原始 DOC/PDF、截图、测试数据或浏览器 `localStorage`。
