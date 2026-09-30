import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCopy, ExternalLink } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchCameraFtpStatus, type CameraFtpStatusData } from "../../lib/api";

const configuredProductDocsUrl = import.meta.env.VITE_CAMERA_FTP_DOCS_URL?.trim() || "";
const productDocsUrl = /^https:\/\//i.test(configuredProductDocsUrl) ? configuredProductDocsUrl : "";

function Command({ children, admin = false }: { children: string; admin?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-3 rounded-xl border border-slate-200 bg-slate-900 p-3 text-slate-100">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-slate-300">
        <span>{admin ? "管理员 PowerShell" : "PowerShell · 只读"}</span>
        <button type="button" className="inline-flex items-center gap-1 hover:text-white" onClick={() => { void navigator.clipboard.writeText(children).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }); }}><ClipboardCopy size={14} />{copied ? "已复制" : "复制"}</button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs leading-6">{children}</pre>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return <section id={id} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-lg font-semibold text-slate-900">{title}</h2><div className="mt-3 space-y-3 text-sm leading-7 text-slate-700">{children}</div></section>;
}

export function CameraFtpGuidePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState<CameraFtpStatusData | null>(null);
  useEffect(() => { void fetchCameraFtpStatus().then((response) => { if (response.ok) setStatus(response.data); }); }, []);
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }, [location.hash]);

  const username = status?.account?.username || "camera";
  const port = status?.controlPort || 21;
  const passiveStart = status?.passivePorts?.start || 50000;
  const passiveEnd = status?.passivePorts?.end || 50100;
  const siteName = "MediaPhotoWorkbenchFTP";

  return (
    <div className="h-full overflow-y-auto pr-2">
      <div className="mx-auto max-w-4xl space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h1 className="text-2xl font-bold text-slate-900">相机 FTP · IIS 配置与排查</h1><p className="mt-2 text-sm text-slate-500">本页随工作台离线提供。请在 IIS 中完成一次配置，之后可由工作台控制站点并切换活动目录。</p></div>
          <div className="flex gap-2"><button type="button" onClick={() => navigate("/host/import")} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm"><ArrowLeft size={16} />返回图片导入</button>{productDocsUrl && <a href={productDocsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-blue-200 px-3 py-2 text-sm text-blue-700"><ExternalLink size={16} />查看官网最新版</a>}</div>
        </div>

        <Section id="requirements" title="1. 配置前准备">
          <p>需要 Windows 11 管理员账户、已设置的图片仓库，以及一个可接收图片的活动。记录当前工作台显示的控制端口和 FTP 用户名。本机配置为端口 <strong>{port}</strong>、账户 <strong>{username}</strong>。</p>
          <p>修改 Windows 功能、服务、账户、IIS 或防火墙前，请先确认这些设置不会影响电脑上已有的 FTP 站点。不要删除默认 Web 站点或无关 FTP 站点。</p>
        </Section>

        <Section id="features" title="2. 启用 IIS FTP 组件">
          <ol className="list-decimal space-y-1 pl-5"><li>按 Win 键，搜索并打开「启用或关闭 Windows 功能」。</li><li>展开「Internet Information Services」→「FTP 服务器」，勾选「FTP 服务」和「FTP 扩展性」。</li><li>展开「Web 管理工具」，勾选「IIS 管理控制台」和「IIS 管理脚本和工具」，点击「确定」。</li><li>等待 Windows 完成安装，再重新打开此窗口确认勾选状态。</li></ol>
          <p>WebServer 网站功能不是相机 FTP 的必需项。已勾选的功能无需重复安装。</p>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：用只读命令核对组件状态</summary><Command>{"Get-WindowsOptionalFeature -Online | Where-Object FeatureName -Match '^IIS-(FTP|Management)' | Sort-Object FeatureName | Format-Table FeatureName, State -AutoSize"}</Command></details>
          <p>如果功能显示 EnablePending，等组件安装完成后按 Windows 明确提示重启；仅因工作台检测失败不需要盲目重启。</p>
        </Section>

        <Section id="service" title="3. 检查 Microsoft FTP Service">
          <ol className="list-decimal space-y-1 pl-5"><li>按 Win 键，搜索并打开「服务」。</li><li>找到「Microsoft FTP Service」，双击打开；服务名应为 FTPSVC。</li><li>若启动类型为「禁用」，改为「手动」并点击「应用」。若服务状态为「已停止」，点击「启动」。</li><li>看到「正在运行」后返回工作台刷新状态。</li></ol>
          <p>工作台只控制自己的 FTP 站点，不会启停共享的 FTPSVC；如果本机有其他 FTP 站点，请先确认启动共享服务的影响。</p>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：用只读命令查看服务</summary><Command>{"Get-CimInstance Win32_Service -Filter \"Name='FTPSVC'\" | Select-Object Name, State, StartMode, ProcessId"}</Command></details>
          <p>若服务不存在，请返回上一节核对 Windows 功能；若启动失败，在事件查看器的 Windows 日志中查询对应时间的系统错误，不要直接重置 IIS。</p>
        </Section>

        <Section id="account" title="4. 创建相机 FTP 账户">
          <p>建议使用本地账户 <strong>{username}</strong>，密码由您自己设置，不要与 Windows 登录密码复用。账户描述必须是 <code>Media Photo Workbench Managed FTP Account</code>，工作台以此验证归属。</p>
          <ol className="list-decimal space-y-1 pl-5"><li>右键「此电脑」→「管理」→「本地用户和组」→「用户」。</li><li>若不存在 <strong>{username}</strong>，右键空白处选择「新用户」，填写用户名、独立密码及上述完整描述；若已存在，双击账户核对描述和是否被禁用。</li><li>确认账户可以使用，且不要修改不属于工作台的同名账户。</li></ol>
          <p>如果系统没有「本地用户和组」，可请电脑管理员协助；不要为了这一步重置 IIS。</p>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：管理员命令示例，仅用于新建账户</summary><Command admin>{`$ftpPassword = Read-Host '输入相机 FTP 密码' -AsSecureString\nNew-LocalUser -Name '${username}' -Password $ftpPassword -Description 'Media Photo Workbench Managed FTP Account'`}</Command></details>
          <p>如果账户已存在，先检查是否确属工作台，再手工设置 Description；工作台不会改动已有账户或密码。</p>
        </Section>

        <Section id="site" title="5. 创建工作台 FTP 站点">
          <ol className="list-decimal space-y-1 pl-5"><li>按 Win 键，搜索并打开「Internet Information Services (IIS) 管理器」。</li><li>展开左侧电脑名，点击「网站」。若已有 <strong>{siteName}</strong>，先选中并核对配置，不要重复创建。</li><li>若不存在，右键「网站」→「添加 FTP 站点」，站点名填 <strong>{siteName}</strong>，物理路径选择当前接收活动的 <code>working/活动目录/原图/相机FTP/</code>；请先在资源管理器中确认目录存在。</li><li>继续按下一节填写绑定和身份验证，完成后在 IIS 左侧确认站点出现。</li></ol>
          <p>站点名称应完全一致；工作台通过管理员只读检测后才会登记其 Site ID。</p>
          <p>若已有同名站点但不是为本工作台配置的，不要直接改写。先在 IIS 中确认用途，并按指导重新整理名称与站点归属。</p>
        </Section>

        <Section id="binding" title="6. 绑定控制端口">
          <p>创建站点时，或选中已有站点后点击右侧「绑定」，确认类型为 FTP、IP 地址为「全部未分配」(*)、端口为 <strong>{port}</strong>、主机名为空。控制端口不能与其他 FTP 站点冲突，也不能落入被动端口范围。</p>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：用只读命令检查端口与站点</summary><Command>{`Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess`}</Command><Command>{`& "$env:windir\\System32\\inetsrv\\appcmd.exe" list site`}</Command></details>
        </Section>

        <Section id="auth" title="7. 身份验证、授权与 SSL">
          <ol className="list-decimal space-y-1 pl-5"><li>在 IIS 左侧选中工作台 FTP 站点，打开「FTP 身份验证」：启用「基本身份验证」，禁用「匿名身份验证」。</li><li>打开「FTP 授权规则」：允许指定用户 <strong>{username}</strong>，同时勾选「读取」和「写入」；检查没有相反的拒绝规则。</li><li>打开「FTP SSL 设置」，将 SSL 策略设为「允许 SSL」而非「要求 SSL」，相机连接时选择普通 FTP／不使用 SSL。</li></ol>
          <p>普通 FTP 会明文传输账户和图片，请仅在可信局域网或 Windows 热点使用，并为相机 FTP 设置独立密码。</p>
        </Section>

        <Section id="permissions" title="8. 配置可继承的目录权限">
          <ol className="list-decimal space-y-1 pl-5"><li>在资源管理器打开图片仓库，右键 <code>working</code> 文件夹→「属性」→「安全」→「编辑」。</li><li>点击「添加」，输入 <strong>{username}</strong>，点击「检查名称」确认后确定。</li><li>选中该账户，在「允许」列勾选「修改」，确认后点击「应用」。</li><li>进入当前活动的「原图/相机FTP」目录，打开「属性」→「安全」→「高级」，确认该账户的「修改」权限来自上级目录继承。</li></ol>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：管理员命令示例，执行前核对路径</summary><Command admin>{`$workspaceParent = Read-Host '输入仓库 working 目录的完整路径'\nif (-not (Test-Path -LiteralPath $workspaceParent -PathType Container)) { throw '目录不存在，未修改 ACL' }\n$acl = Get-Acl -LiteralPath $workspaceParent\n$rule = New-Object System.Security.AccessControl.FileSystemAccessRule('${username}', 'Modify', 'ContainerInherit,ObjectInherit', 'None', 'Allow')\n$acl.AddAccessRule($rule)\nSet-Acl -LiteralPath $workspaceParent -AclObject $acl`}</Command></details>
          <p>执行前核对路径、用户名及现有继承规则。工作台只会读取权限并拒绝不可写目录，不会自动修改 ACL。</p>
        </Section>

        <Section id="passive" title="9. 被动端口">
          <p>在 IIS 管理器左侧点击最上方的电脑名（不要点网站），打开「FTP 防火墙支持」，将「数据通道端口范围」设为 <strong>{passiveStart}–{passiveEnd}</strong>，点击右侧「应用」。这是服务器级共享设置；若有其他 FTP 站点，请先核对它们的要求。</p>
        </Section>

        <Section id="firewall" title="10. Windows 防火墙">
          <ol className="list-decimal space-y-1 pl-5"><li>按 Win 键，搜索并打开「高级安全 Windows Defender 防火墙」。</li><li>点击「入站规则」→「新建规则」→「端口」→「TCP」，为控制端口 <strong>{port}</strong> 建立「允许连接」规则。</li><li>再为被动端口范围 <strong>{passiveStart}–{passiveEnd}</strong> 建立一条 TCP 入站规则。</li><li>在两条规则的「作用域」中尽量将远程 IP 限定为本地子网；使用热点时也要允许热点网段。</li></ol>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：管理员命令示例，先确认同名规则不存在</summary><Command admin>{`New-NetFirewallRule -DisplayName 'Media Photo Workbench - FTP Control' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${port} -RemoteAddress LocalSubnet\nNew-NetFirewallRule -DisplayName 'Media Photo Workbench - FTP Passive' -Direction Inbound -Action Allow -Protocol TCP -LocalPort ${passiveStart}-${passiveEnd} -RemoteAddress LocalSubnet`}</Command></details>
        </Section>

        <Section id="verification" title="11. 验证配置">
          <ol className="list-decimal space-y-1 pl-5"><li>返回工作台「图片导入」→「相机 FTP」，点击「以管理员权限检查站点」。Windows 弹窗出现时确认是本次工作台操作。</li><li>如果页面提示没有有效接收活动，先在下方选择活动并点击「切换接收活动」。</li><li>确认「站点状态」和接收目录后再启动 FTP；已运行时可用相机尝试连接。</li></ol>
          <p>管理员检测只读取状态，不修改 IIS。普通检测显示「尚未确认」不代表配置损坏。</p>
          <details className="rounded-lg bg-slate-50 p-3"><summary className="cursor-pointer">高级：用只读命令交叉核对</summary><Command>{`Get-CimInstance Win32_Service -Filter \"Name='FTPSVC'\" | Select-Object Name, State, ProcessId\nGet-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object LocalAddress, LocalPort, OwningProcess`}</Command></details>
        </Section>

        <Section id="troubleshooting" title="12. 常见问题">
          <p><strong>FTP_ACTIVE_EVENT_NOT_FOUND：</strong>工作台保存的接收活动不在当前数据库中。先核对「系统设置」里的数据库与仓库路径，再回到相机 FTP 页面选择现有活动并点击「切换接收活动」；不要仅为此重建 IIS 站点。</p>
          <p><strong>IIS_FTP_FEATURE_MISSING：</strong>回到 Windows 功能核对 FTP Service 与管理组件。</p>
          <p><strong>FTP_SERVICE_NOT_RUNNING：</strong>手工检查并启动 FTPSVC；若失败查看 Windows 系统事件。</p>
          <p><strong>MANAGED_SITE_ID_MISMATCH：</strong>确认站点名和 Site ID，避免把无关站点当作工作台站点。</p>
          <p><strong>SITE_BINDING_MISMATCH / FTP_CONTROL_PORT_IN_USE：</strong>核对绑定端口和占用进程。</p>
          <p><strong>FTP_AUTHORIZATION_MISMATCH：</strong>核对基本认证、读写授权以及拒绝规则。</p>
          <p><strong>FTP_DIRECTORY_PERMISSION_REQUIRED：</strong>核对 working 父目录的继承权限和目标目录的有效权限。</p>
          <p>相机连不上时，先确认相机与主机在同一可互访网络。校园 Wi-Fi 可能隔离客户端；可尝试 Windows 移动热点，常见地址是 192.168.137.1，但应以本机实际地址为准。多台相机使用不同文件名前缀，避免同名覆盖。</p>
        </Section>
      </div>
    </div>
  );
}
