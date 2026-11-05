# 企业微信 → 面试排期站点同步（部署说明）

这个仓库提供接收同步数据的服务端代码，但当前并未连接公司企业微信。需要先部署 Cloudflare Worker/D1 和配置内部 WorkBuddy 的定时查询。

## 架构
企业微信（获授权的两位面试官忙闲） → WorkBuddy 专家 → 现有内部系统 → 带 SYNC_TOKEN 的 POST /api/sync → D1 → 网页每30秒读取 /api/events。

现有 GitHub Pages 不支持运行数据库/回调，必须另有服务端。本服务端不会接收或存储日程标题、候选人姓名等企微隐私信息，只有面试官标识、忙碌开始和结束时间。网站的人工预约备注独立存储在受保护的数据库。

企业微信 API 不能假定能读取面试官在个人日历自己创建的全部日程；WorkBuddy 在合法授权范围内可能读取日程和多人忙闲。应用创建的日历在特定条件下可用回调，普通个人日程建议 WorkBuddy 定时读取，频率2至5分钟。无法保证秒级。

## 部署
1. 安装 Cloudflare Wrangler CLI，在 sync 目录中执行 npx wrangler login。
2. npx wrangler d1 create hr_interview_scheduler，将返回的数据库ID填入 wrangler.toml（先复制 wrangler.toml.example）。
3. npx wrangler d1 execute hr_interview_scheduler --remote --file=./schema.sql。
4. 设置三个不同的长随机密钥（不要上传仓库）：npx wrangler secret put VIEW_TOKEN；npx wrangler secret put WRITE_TOKEN；npx wrangler secret put SYNC_TOKEN。
5. 执行 npx wrangler deploy，获得 Worker URL。
6. 网页中「企业微信同步」输入 Worker URL 以及 VIEW_TOKEN、WRITE_TOKEN（只保存在会话中）；SYNC_TOKEN 只能放内部系统服务端。
7. 企业微信管理员需确认 WorkBuddy 专家能够获授权查询李鹤及张永宾的忙闲。内部系统通过专家获取完整忙闲快照，并调用 POST /api/sync。

注意：如果没有 Cloudflare，也可以在公司现有内部系统中实现同样的 HTTP 接口和数据库，站点无需改变。

## 接口说明
GET /api/health 无授权。
GET /api/events?from=2026-11-09T00:00:00%2B08:00&to=2026-11-14T00:00:00%2B08:00 需 Authorization: Bearer VIEW_TOKEN。
POST /api/sync 需 Authorization: Bearer SYNC_TOKEN。
POST /api/bookings 需 Authorization: Bearer WRITE_TOKEN。
DELETE /api/bookings/:uuid 需 Authorization: Bearer WRITE_TOKEN。

## 日程快照
POST /api/sync 的JSON请求体（示例是虚构忙闲）：
{
  "from": "2026-11-09T00:00:00+08:00",
  "to": "2026-11-14T00:00:00+08:00",
  "events": [
    {"id":"event-1","person":"li","start":"2026-11-09T14:00:00+08:00","end":"2026-11-09T15:00:00+08:00"},
    {"id":"event-2","person":"zhang","start":"2026-11-09T14:00:00+08:00","end":"2026-11-09T15:00:00+08:00"}
  ]
}
person 只允许 li 或 zhang。所有时间带时区。ID要在同一实际事件中稳定，重复日程应为每次实例生成不同ID。当前同步按整个日期窗口全量替换：必须取完整快照，不得将查询失败视作空快照，否则会误将占用恢复为可约。取消日程时，下次完整快照不再有该事件，原时段才恢复。

站点页面现在固定在2026-11-09至13，若扩展滚动周视图，要同时更新前端查询区间。

## 安全与权限
公开仓库不得提交任何企业微信密钥、授权token、个人日程、简历、候选人资料。用户访问的 VIEW_TOKEN 与 WRITE_TOKEN 当前是单人MVP的会话令牌，不是正式的SSO权限系统；正式多人使用建议接入公司统一身份认证、审计和最小权限。工作台仅用「忙闲」数据，不直接读取面试以外的日程详情。
