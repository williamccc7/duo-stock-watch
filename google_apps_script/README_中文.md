# 改成计划每 5 分钟检查一次（Google Apps Script）

GitHub Actions 的定时任务最低间隔 5 分钟，而且你原来的 GitHub 任务实际经常延迟几个小时，所以不要靠修改 cron 到 * * * * * 来追求 1 分钟。

Google Apps Script 官方允许 5 分钟定时器，且无需 Mac 开机、无需服务器、无需 App Password。它用你的 Google 账户权限发 Gmail。

## 零基础安装（在 Mac 的浏览器完成）

1. 打开 https://script.google.com/home/projects/create ，使用你希望收到库存提醒的 Google 账户登录。
2. 给项目改名为 `iPhone Duo 5-minute stock watch`。
3. 左边点 `Editor`（编辑器）。打开 `Code.gs`，按 Command + A 全选默认内容并删掉。
4. 在另一个浏览器标签页打开本仓库的 `google_apps_script/Code.gs`，点击代码右上角的 `Copy raw file`（或者打开 Raw 并复制所有内容），把整份内容粘贴到 Google 编辑器。
5. 按 Command + S 保存。
6. 上方函数下拉菜单选择 `testEmail`，点击 `Run`。首次运行会要求授予权限，确认是你创建的项目和代码后，按提示授权。检查 Gmail 有没有收到 `TEST — iPhone Duo 5-minute monitor`。
7. 下拉菜单选择 `checkStock`，再按 `Run`。查看下面的 `Execution log`：
   - `Currently unavailable.` = 查询成功，目前缺货
   - `New stock found; Gmail alert sent.` = 有货，发信成功
   - `Inventory check failed` = 查询失败，**不能当作缺货**；请复制错误文字回来排查，先不要继续
8. 确认第 7 步查询成功，再选择 `startEveryFiveMinutes` 并按 `Run`。
9. 左侧点击闹钟图标 `Triggers`，确认列表有 `checkStock` 的 `Time-driven` 定时任务。
10. 运行状态可以从 `Executions` 或运行 `showStatus` 查看。

成功后，打开原 GitHub 仓库：`Actions → Evergreen Walk iPhone Duo stock (Gmail) → 右上角 ... → Disable workflow`，避免两份监控重复提醒。**先别停旧版，直到新版检查成功**。

## 以后暂停

在 Apps Script 上方函数菜单选 `stopMonitoring`，点击 `Run`；或到 `Triggers` 中删除 `checkStock` 触发器。

## 重要限制

- 每五分钟是计划触发，不能保证精确到秒，Google 也会有执行延迟。
- Apple 使用的是非正式库存接口，可能封锁、返回错误或调整数据。遇到连续 3 次错误会发一封提醒，最长每 6 小时一次。
- Gmail 是 Google 账户自己给自己发送邮件。邮件送达与 iPhone 是否弹出 Gmail 横幅是两件事，需要在 iOS/Gmail 设置里单独测试。
- 2026 年 Google 个人账户的 Apps Script 免费额度包括 URL Fetch 每日 20,000 次、触发器总运行时间每日 90 分钟，以及邮件收件人数每日 100。288 次/日通常低于 URL Fetch 配额，但如果单次运行较慢，**可能耗尽每日触发器运行时长**。
- 如果收到限额、超时或苹果网站响应异常，需要调整运行频率或换云端方案。
- 监控仅限 Apple Evergreen Walk (R613)、Star White、256GB (MK1E4LL/A)，No Trade-in 和 Connect to any carrier later 应在结账时选择确认。

## 2026-10-30：HTTP 541 偶发错误处理

Apple 有时会拒绝自动查询并返回 HTTP 541；这不表示缺货。现在代码将一次失败留给下一轮 5 分钟定时查询，不会马上重试。如果连续出现 2 次 541，就暂停请求 15 分钟；恢复查询后若仍然失败则暂停 30 分钟，再失败最多冷却 60 分钟。期间仍然由 Google 按 5 分钟启动脚本，但会跳过网络请求，以减少持续触发 Apple 限制。连续失败会触发最多每 6 小时一次的邮件警报。**冷却期间可能错过短暂补货**，这是自动限制与高频查询之间的取舍。

已部署在 Google Apps Script 的用户需手动更新，因为 GitHub 文件不会自动同步至 Google：

1. 在 Google Apps Script 中打开现有 `iPhone Duo Stock Monitor` 项目，选择编辑器中的 `Code.gs`。
2. 打开 GitHub 的 `google_apps_script/Code.gs`，复制完整文件。
3. 在 Apps Script 编辑器内全选旧代码、粘贴新版，按 Command + S 保存。
4. **不要再运行 `startEveryFiveMinutes`**，原来的 `checkStock` 定时触发器依然存在。
5. 可以选 `showStatus` 点 Run，或查看 Executions 中的日志是否出现 `Currently unavailable.`、`Apple HTTP 541 cooldown active` 等。

如果 541 频繁且长期无法恢复，按项目情况考虑降低到每 10 分钟（需要修改每 5 分钟的触发器），或改用 Apple 官方页面人工确认。该接口并非 Apple 公开承诺稳定的 API。
