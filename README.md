# Apple Evergreen Walk · iPhone Duo 256GB Star White 库存监控（Gmail）

此仓库使用 GitHub Actions **每 10 分钟计划检查一次** Apple Evergreen Walk 门店的指定机型能否自取。
确认有货且状态从无货变为有货后，通过 Gmail 发邮件。它**不会**自动购买。
Mac 关机后 GitHub Actions 仍可运行，但 GitHub 定时任务可能延迟/跳过，无法保证准点。

## 首次设置：3 个 Repository secrets

在 `Settings → Secrets and variables → Actions → New repository secret` 新增：

| Secret 名称 | 内容 |
|---|---|
| `EMAIL_SENDER` | 用来发送通知的 Gmail 地址 |
| `EMAIL_TO` | 在 iPhone 上接收通知的邮箱地址（可以是另一个 Gmail） |
| `DUO_SMTP_APP_PASSWORD` | 发件 Gmail 的 16 位 **Google 应用专用密码**，不是 Gmail 登录密码 |

生成 Google 应用专用密码（账户须先开启两步验证）：https://myaccount.google.com/apppasswords

应用名称可填 `duo-stock-watch`，创建后将应用密码只保存到上面的 GitHub Secret，不要分享密码或把密码写进仓库文件。
如果你使用的 Google 账户不允许应用专用密码，这个 SMTP 方案无法使用，需要另换邮件发送方式。

## 测试 Gmail 通知

1. 打开仓库的 `Actions`。
2. 选择 **Evergreen Walk iPhone Duo stock (Gmail)**。
3. 点击 **Run workflow**，将 `test_notification` 勾选为 true。
4. 点击绿色 **Run workflow** 按钮。
5. 检查 `EMAIL_TO` 对应邮箱是否收到主题 `Gmail TEST — iPhone Duo Evergreen Walk` 的邮件。
6. 也检查 iPhone Gmail App 是否出现推送。**邮件送达不等于 iPhone 一定会弹窗**，Gmail 和 iOS 通知权限也要打开。

## 测试真正的 Apple 库存检查

再次点 `Run workflow`，但**不要勾选** `test_notification`。
点击执行详情，查看 `Check stock or send Gmail test email` 日志，确认 Apple 查询成功。
如果接口报错，不能把它当作缺货；非公开接口可能发生变更。

## iPhone Gmail App 推送设置

iPhone `设置 → 通知 → Gmail`：开启允许通知、锁屏、横幅和声音。
Gmail App `菜单 → 设置 → Email notifications` 选择 `All new mail`。
关闭通知摘要/专注模式对 Gmail 的静音。如果发给自己同一个 Gmail 账户却收不到横幅，
尝试改成从单独的 Gmail 账户发到手机常用的收件邮箱，然后重新测试。

## 后续

库存检查成功且有货时邮件主题是 `🚨 iPhone Duo AVAILABLE — Evergreen Walk`。
GitHub Actions 上的原 ntfy 推送已经停用，新的流程只使用 Gmail。
若要暂停，打开 `Actions → Evergreen Walk iPhone Duo stock (Gmail) → Disable workflow`。
