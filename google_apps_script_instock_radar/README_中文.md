# InStock Radar 独立双门店监控：安装指南

这是一套**全新的** Google Apps Script 监控，不修改、不停止原有的 Apple 直查监控。

监控目标：iPhone Duo 256 GB Star White；Apple Evergreen Walk、Apple Westfarms。
数据来源：以下两张 InStock Radar 免费库存网页，每分钟计划检查一次，每轮并行查询两张网页。
https://instockradar.com/us/store/evergreenwalk
https://instockradar.com/us/store/westfarms

## 1. 新建第二个 Google Apps Script 项目

1. 打开 https://script.google.com/home/projects/create，用之前的 Google 账户登录。
2. 项目命名为 iPhone Duo InStock Radar Monitor。
3. 进入 Editor → Code.gs，删除默认的 myFunction。
4. 打开新代码：https://github.com/williamccc7/duo-stock-watch/blob/main/google_apps_script_instock_radar/Code.gs
5. 点击 Raw，复制全部代码，粘贴到**新**项目的 Code.gs，按 Command + S 保存。
6. **千万不要覆盖旧项目 iPhone Duo Stock Monitor 的代码。**

## 2. 设置额外收件人（新项目独立配置）

1. 新项目左侧 Project Settings（齿轮）→ Script properties → Add script property。
2. Property：ADDITIONAL_ALERT_EMAILS
3. Value：填写 Jasmine 的 Gmail 地址（和你旧项目的设置相同）。
4. 点击 Save script properties。

主收件人默认是你登录的 Gmail。邮箱不写入公开 GitHub 仓库。

## 3. 测试：先不要启动自动任务

打开 Editor，在上方函数下拉菜单分别运行：

1. testEmail → Run；两个邮箱应收到主题为 [Radar TEST] 的测试邮件。首次运行按提示授权。
2. testParser → Run；日志应显示 All four parser checks passed.
3. testRadarSource → Run；查看 Execution log，必须能看到 Evergreen Walk 和 Westfarms **两条有效库存查询结果**，例如：
   - Evergreen Walk: target not in stock / model sold out / site checked 12 sec. ago
   - Westfarms: target not in stock / model sold out / site checked 9 sec. ago

只有两条都正常时，才可以进入下一步。

如果日志出现 RADAR SOURCE FAILED，说明 Google Apps Script 读取网站失败或网页结构和预期不一致；不要启动定时任务，先把日志发回来排查。注意 Apps Script 显示 Completed 不代表网站解析成功。

## 4. 开启每分钟自动检查

在新项目中选择 startEveryMinute → Run（只运行一次）。

进入左侧 Triggers，确认仅有一条 checkRadarStock 的 Time-driven → Every minute 触发器。不需要 Deploy。

旧项目原来的 checkStock 触发器仍然独立运行，不要删除。

## 5. 运行日志

在新项目 Executions → checkRadarStock：

- Target currently unavailable.：特定型号容量颜色目前无货。
- [RADAR] TARGET IN STOCK — Gmail alerts sent.：有货并已提交双人邮件。
- RADAR STORE CHECK FAILED 或 RADAR CHECK FAILED：查询失败，不能视为缺货。

新旧两套监控可能在同一次补货分别发邮件，这是正常的。新版邮件标题含 [Radar]。

## 注意

- 两页分别监控，仅在 iPhone Duo 256 GB Star White 匹配且显示 In stock 时提醒；其他产品、颜色和历史补货不会触发。
- 用户表示已获网站负责人允许自动读取，但如果许可或网页结构改变，需要重新确认。
- 每分钟只是计划触发，实际时间可能有偏差。网页可能使用缓存或动态 JavaScript；代码无法读取时会报错而非假设缺货。
- 新版每轮额外发起两个网页请求，按计划每天 2,880 次；旧版仍另行查询。关注 Google Apps Script 所有项目共享的免费额度、累计触发器运行时间及邮件限额。
- 有货提醒必须以 Apple 官网实际可预约的库存为准；No trade-in 和 Connect to any carrier later 要在 Apple 结账时确认。
- 若要停止新版，在新项目运行 stopMonitoring 或删除该项目的 checkRadarStock 触发器；旧版不受影响。
