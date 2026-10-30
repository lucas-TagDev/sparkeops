import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import nodemailer from "nodemailer";
import {
  Platform,
  hash,
  now,
  passwordHash,
  passwordMatches,
  emailAddress,
  type Principal,
} from "./platform.ts";
import { AISettings } from "./ai-settings.ts";
import { BrandingSettings } from "./branding.ts";
import { APIError } from "./store.ts";
import { publicAddress } from "./url-probe.ts";
type Config = {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
};
type Mail = { to: string; subject: string; text: string };
export class PlatformEmail {
  platform: Platform;
  vault: AISettings;
  branding: BrandingSettings;
  origin: string;
  sender?: (c: Config, m: Mail) => Promise<void>;
  running = false;
  constructor(
    platform: Platform,
    vault: AISettings,
    branding: BrandingSettings,
    origin: string,
    sender?: (c: Config, m: Mail) => Promise<void>,
  ) {
    this.platform = platform;
    this.vault = vault;
    this.branding = branding;
    this.origin = new URL(origin).origin;
    this.sender = sender;
    platform.store.db
      .exec(`CREATE TABLE IF NOT EXISTS platform_email_config(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS account_email_tokens(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,kind TEXT NOT NULL,new_email TEXT,credential_hash TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER);
  CREATE TABLE IF NOT EXISTS platform_email_queue(id TEXT PRIMARY KEY,payload TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,sent_at INTEGER,last_error TEXT);`);
  }
  authorize(p: Principal) {
    if (p.orgScope || !this.branding.canManage(p))
      throw new APIError(
        403,
        "Somente o administrador geral pode configurar os e-mails da plataforma.",
      );
  }
  config(): Config | null {
    const row = this.platform.store.db
      .prepare("SELECT value FROM platform_email_config WHERE id=1")
      .get();
    return row
      ? JSON.parse(
          this.vault.reveal("platform", "email-config", String(row.value)),
        )
      : null;
  }
  settings(p: Principal) {
    this.authorize(p);
    const c = this.config();
    const delivery = this.platform.store.db
      .prepare(
        `SELECT sum(CASE WHEN sent_at IS NULL AND expires_at>unixepoch() AND attempts<5 THEN 1 ELSE 0 END) AS pending,sum(CASE WHEN sent_at IS NULL AND (attempts>=5 OR expires_at<=unixepoch()) THEN 1 ELSE 0 END) AS failed,max(sent_at) AS last_sent_at FROM platform_email_queue`,
      )
      .get();
    return {
      ...(c
        ? { ...c, password: undefined, has_password: !!c.password }
        : {
            enabled: false,
            host: "",
            port: 587,
            user: "",
            from: "",
            has_password: false,
          }),
      origin: this.origin,
      require_account_confirmation: this.platform.accountConfirmationRequired(),
      delivery,
    };
  }
  save(p: Principal, d: Record<string, unknown>) {
    this.authorize(p);
    const old = this.config();
    const c: Config = {
      enabled: d.enabled === true,
      host: String(d.host ?? "").trim(),
      port: Number(d.port),
      user: String(d.user ?? "").trim(),
      password:
        d.password === undefined || d.password === ""
          ? (old?.password ?? "")
          : String(d.password),
      from: emailAddress(d.from),
    };
    if (
      typeof d.enabled !== "boolean" ||
      !c.host ||
      c.host.length > 253 ||
      !/^([a-z0-9-]+\.)*[a-z0-9-]+$/i.test(c.host) ||
      ![465, 587].includes(c.port) ||
      !c.user ||
      c.user.length > 254 ||
      !c.password ||
      c.password.length > 1000
    )
      throw new APIError(
        400,
        "Configuração de e-mail inválida. Use SMTP nas portas 465 ou 587.",
      );
    const requireConfirmation =
      d.require_account_confirmation === undefined
        ? this.platform.accountConfirmationRequired()
        : d.require_account_confirmation;
    if (
      typeof requireConfirmation !== "boolean" ||
      (requireConfirmation && !c.enabled)
    )
      throw new APIError(
        400,
        "Habilite o SMTP antes de exigir confirmação de conta.",
      );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare(
          "INSERT INTO platform_email_config VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        )
        .run(this.vault.protect("platform", "email-config", JSON.stringify(c)));
      this.platform.store.db
        .prepare(
          "INSERT INTO account_registration_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET require_confirmation=excluded.require_confirmation",
        )
        .run(requireConfirmation ? 1 : 0);
      this.platform.audit(p, "platform.email.updated");
    });
    return this.settings(p);
  }
  enqueue(m: Mail, expires = now() + 86400) {
    const id = randomUUID();
    this.platform.store.db
      .prepare(
        "INSERT INTO platform_email_queue(id,payload,next_at,expires_at) VALUES (?,?,?,?)",
      )
      .run(
        id,
        this.vault.protect("platform", "email-message", JSON.stringify(m)),
        now(),
        expires,
      );
  }
  async deliver(c: Config, m: Mail) {
    if (this.sender) return this.sender(c, m);
    const addresses = await lookup(c.host, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("smtp-host");
    const transport = nodemailer.createTransport({
      host: addresses[0].address,
      port: c.port,
      secure: c.port === 465,
      requireTLS: true,
      tls: { servername: c.host, rejectUnauthorized: true },
      auth: { user: c.user, pass: c.password },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      await transport.sendMail({
        ...m,
        from: { name: this.branding.public().name, address: c.from },
      });
    } finally {
      transport.close();
    }
  }
  async test(p: Principal) {
    this.authorize(p);
    const c = this.config();
    if (!c?.enabled)
      throw new APIError(400, "Habilite e salve o envio de e-mails primeiro.");
    try {
      await this.deliver(c, {
        to: p.email,
        subject: "Teste de e-mail da plataforma",
        text: "O envio de e-mails da plataforma está funcionando.",
      });
    } catch {
      throw new APIError(
        502,
        "Não foi possível enviar o e-mail. Verifique servidor, porta e credenciais SMTP.",
      );
    }
    this.platform.audit(p, "platform.email.test");
    return { ok: true };
  }
  createToken(
    user: { id: string; email: string; password_hash: string },
    kind: string,
    newEmail?: string,
  ) {
    const token = randomBytes(32).toString("hex");
    this.platform.store.db
      .prepare(
        "UPDATE account_email_tokens SET used_at=? WHERE user_id=? AND kind=? AND used_at IS NULL",
      )
      .run(now(), user.id, kind);
    this.platform.store.db
      .prepare("INSERT INTO account_email_tokens VALUES (?,?,?,?,?,?,NULL)")
      .run(
        hash(token),
        user.id,
        kind,
        newEmail ?? null,
        hash(user.email + ":" + user.password_hash),
        now() + 1800,
      );
    return token;
  }
  accountNotice(userId: string, kind: "welcome" | "password") {
    if (!this.config()?.enabled) return;
    const row = this.platform.store.db
      .prepare("SELECT email FROM users WHERE id=?")
      .get(userId);
    if (!row) return;
    this.enqueue({
      to: String(row.email),
      subject:
        this.branding.public().name +
        (kind === "welcome" ? " — boas-vindas" : " — senha alterada"),
      text:
        kind === "welcome"
          ? "Sua conta foi criada. Acesse a plataforma para cadastrar seus servidores e configurar o monitoramento.\n\n" +
            this.origin
          : "Um administrador redefiniu a senha da sua conta. As sessões anteriores foram encerradas. Se você não reconhece esta alteração, procure o administrador da plataforma.",
    });
  }
  queueAccountConfirmation(userId: string) {
    if (!this.platform.pendingAccountConfirmation(userId)) return;
    if (!this.config()?.enabled)
      throw new APIError(
        503,
        "Envio de confirmação indisponível. Contate o administrador.",
      );
    const user = this.platform.store.db
      .prepare(
        "SELECT id,email,password_hash FROM users WHERE id=? AND NOT EXISTS(SELECT 1 FROM user_access WHERE user_id=users.id AND disabled=1)",
      )
      .get(userId) as
      { id: string; email: string; password_hash: string } | undefined;
    if (!user) return;
    const token = this.createToken(user, "account");
    this.enqueue(
      {
        to: user.email,
        subject: this.branding.public().name + " — confirme sua conta",
        text:
          "Confirme seu e-mail para ativar o acesso à plataforma. O link é válido por 30 minutos e pode ser usado uma única vez.\n\n" +
          this.origin +
          "/#confirm-account=" +
          token,
      },
      now() + 1800,
    );
  }
  resendAccountConfirmation(value: unknown) {
    const email = emailAddress(value);
    const result = {
      ok: true,
      message:
        "Se houver uma conta aguardando confirmação, enviaremos um novo link.",
    };
    if (!this.platform.accountConfirmationRequired()) return result;
    if (!this.config()?.enabled)
      throw new APIError(
        503,
        "Envio de confirmação indisponível. Contate o administrador.",
      );
    const user = this.platform.store.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get(email);
    if (user)
      this.platform.transaction(() =>
        this.queueAccountConfirmation(String(user.id)),
      );
    return result;
  }
  confirmAccount(token: unknown) {
    this.platform.transaction(() => {
      const row = this.consume(token, "account"),
        id = String(row.user_id);
      const result = this.platform.store.db
        .prepare(
          "UPDATE user_email_verification SET verified_at=? WHERE user_id=? AND email=? AND verified_at IS NULL",
        )
        .run(now(), id, String(row.email));
      if (!result.changes)
        throw new APIError(
          400,
          "Link inválido ou expirado. Solicite um novo link.",
        );
      this.revoke(id);
      this.auditUser(id, "user.account.confirmed");
      this.accountNotice(id, "welcome");
    });
    return { ok: true };
  }
  forgot(value: unknown) {
    const email = emailAddress(value);
    const generic = {
      ok: true,
      message:
        "Se houver uma conta ativa para este e-mail, enviaremos as instruções de recuperação.",
    };
    if (!this.config()?.enabled) return generic;
    const user = this.platform.store.db
      .prepare(
        "SELECT id,email,password_hash FROM users WHERE email=? AND NOT EXISTS(SELECT 1 FROM user_access a WHERE a.user_id=users.id AND a.disabled=1)",
      )
      .get(email) as
      { id: string; email: string; password_hash: string } | undefined;
    if (user)
      this.platform.transaction(() => {
        const token = this.createToken(user, "reset");
        this.enqueue(
          {
            to: email,
            subject: this.branding.public().name + " — redefinir senha",
            text:
              "Para definir uma nova senha, abra o link abaixo. Ele expira em 30 minutos e só pode ser usado uma vez. Se você não solicitou, ignore esta mensagem.\n\n" +
              this.origin +
              "/#reset=" +
              token,
          },
          now() + 1800,
        );
      });
    return generic;
  }
  consume(token: unknown, kind: string) {
    if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
      throw new APIError(
        400,
        "Link inválido ou expirado. Solicite um novo link.",
      );
    const row = this.platform.store.db
      .prepare(
        `SELECT t.*,u.email,u.password_hash FROM account_email_tokens t JOIN users u ON u.id=t.user_id WHERE token_hash=? AND kind=? AND used_at IS NULL AND expires_at>? AND NOT EXISTS(SELECT 1 FROM user_access a WHERE a.user_id=u.id AND a.disabled=1)`,
      )
      .get(hash(token), kind, now());
    if (
      !row ||
      row.credential_hash !== hash(row.email + ":" + row.password_hash)
    )
      throw new APIError(
        400,
        "Link inválido ou expirado. Solicite um novo link.",
      );
    return row;
  }
  revoke(user: string) {
    const db = this.platform.store.db;
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(user);
    db.prepare(
      "UPDATE api_tokens SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL",
    ).run(now(), user);
    db.prepare(
      "UPDATE account_email_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL",
    ).run(now(), user);
  }
  auditUser(user: string, action: string) {
    for (const m of this.platform.store.db
      .prepare("SELECT tenant_id FROM memberships WHERE user_id=?")
      .all(user)) {
      const p = this.platform.principal(user, String(m.tenant_id));
      this.platform.audit(p, action, user);
    }
  }
  reset(d: Record<string, unknown>) {
    const encoded = passwordHash(d.password);
    this.platform.transaction(() => {
      const row = this.consume(d.token, "reset"),
        id = String(row.user_id);
      this.platform.store.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(encoded, id);
      this.revoke(id);
      this.auditUser(id, "user.password.recovered");
      this.enqueue({
        to: String(row.email),
        subject: "Senha alterada",
        text: "A senha da sua conta foi redefinida. Se você não reconhece esta alteração, procure o administrador da plataforma.",
      });
    });
    return { ok: true };
  }
  changePassword(p: Principal, d: Record<string, unknown>) {
    if (p.orgScope) throw new APIError(403, "Use sua sessão de usuário.");
    const user = this.platform.store.db
      .prepare("SELECT password_hash FROM users WHERE id=?")
      .get(p.userId);
    if (
      !user ||
      !passwordMatches(d.current_password, String(user.password_hash))
    )
      throw new APIError(400, "Senha atual incorreta.");
    if (d.password !== d.confirm_password)
      throw new APIError(400, "As senhas não coincidem.");
    const encoded = passwordHash(d.password);
    if (passwordMatches(d.password, String(user.password_hash)))
      throw new APIError(
        400,
        "A nova senha deve ser diferente da senha atual.",
      );
    this.platform.transaction(() => {
      this.platform.store.db
        .prepare("UPDATE users SET password_hash=? WHERE id=?")
        .run(encoded, p.userId);
      this.revoke(p.userId);
      this.auditUser(p.userId, "user.password.changed");
    });
    try {
      if (this.config()?.enabled)
        this.enqueue({
          to: p.email,
          subject: this.branding.public().name + " — senha alterada",
          text: "A senha da sua conta foi alterada nas configurações. As sessões anteriores foram encerradas. Se você não reconhece esta alteração, procure o administrador da plataforma.",
        });
    } catch {
      console.error("Não foi possível preparar o aviso de alteração de senha.");
    }
    return { ok: true };
  }
  changeEmail(p: Principal, d: Record<string, unknown>) {
    if (p.orgScope) throw new APIError(403, "Use sua sessão de usuário.");
    if (!this.config()?.enabled)
      throw new APIError(
        503,
        "O envio de e-mails da plataforma ainda não foi configurado.",
      );
    const email = emailAddress(d.email);
    const user = this.platform.store.db
      .prepare("SELECT id,email,password_hash FROM users WHERE id=?")
      .get(p.userId) as { id: string; email: string; password_hash: string };
    if (!passwordMatches(d.password, user.password_hash))
      throw new APIError(400, "Senha atual incorreta.");
    if (
      email === user.email ||
      this.platform.store.db
        .prepare("SELECT 1 FROM users WHERE email=?")
        .get(email)
    )
      throw new APIError(
        409,
        "Não é possível utilizar este endereço de e-mail.",
      );
    this.platform.transaction(() => {
      const token = this.createToken(user, "email", email);
      this.enqueue(
        {
          to: email,
          subject: "Confirme seu novo e-mail",
          text:
            "Confirme a alteração do e-mail da sua conta pelo link abaixo. Ele expira em 30 minutos.\n\n" +
            this.origin +
            "/#confirm-email=" +
            token,
        },
        now() + 1800,
      );
      this.platform.audit(p, "user.email.change_requested");
    });
    return { ok: true };
  }
  confirmEmail(token: unknown) {
    this.platform.transaction(() => {
      const row = this.consume(token, "email"),
        id = String(row.user_id);
      if (
        this.platform.store.db
          .prepare("SELECT 1 FROM users WHERE email=?")
          .get(String(row.new_email))
      )
        throw new APIError(
          409,
          "Não é possível utilizar este endereço de e-mail.",
        );
      this.platform.store.db
        .prepare("UPDATE users SET email=? WHERE id=?")
        .run(String(row.new_email), id);
      this.platform.store.db
        .prepare(
          "UPDATE user_email_verification SET email=?,verified_at=? WHERE user_id=?",
        )
        .run(String(row.new_email), now(), id);
      this.revoke(id);
      this.auditUser(id, "user.email.changed");
      this.enqueue({
        to: String(row.email),
        subject: "E-mail da conta alterado",
        text: "O endereço de e-mail da sua conta foi alterado. Se você não reconhece esta alteração, procure o administrador da plataforma.",
      });
    });
    return { ok: true };
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const c = this.config();
      if (!c?.enabled) return;
      for (const row of this.platform.store.db
        .prepare(
          "SELECT id,payload,attempts FROM platform_email_queue WHERE sent_at IS NULL AND attempts<5 AND next_at<=? AND expires_at>? ORDER BY next_at LIMIT 5",
        )
        .all(now(), now())) {
        try {
          await this.deliver(
            c,
            JSON.parse(
              this.vault.reveal(
                "platform",
                "email-message",
                String(row.payload),
              ),
            ),
          );
          this.platform.store.db
            .prepare(
              "UPDATE platform_email_queue SET sent_at=?,payload='',last_error=NULL WHERE id=?",
            )
            .run(now(), String(row.id));
        } catch {
          this.platform.store.db
            .prepare(
              "UPDATE platform_email_queue SET attempts=attempts+1,next_at=?,last_error='smtp_delivery_failed' WHERE id=?",
            )
            .run(
              now() + Math.min(600, 30 * 2 ** Number(row.attempts)),
              String(row.id),
            );
        }
      }
      this.platform.store.db
        .prepare("DELETE FROM account_email_tokens WHERE expires_at<?")
        .run(now() - 86400);
      this.platform.store.db
        .prepare("DELETE FROM platform_email_queue WHERE expires_at<?")
        .run(now() - 7 * 86400);
    } finally {
      this.running = false;
    }
  }
}
