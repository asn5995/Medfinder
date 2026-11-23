// Apply migrations/*.sql to DATABASE_URL. A blank URL does nothing.
// MEDFINDER_DATABASE=production refuses to run. Production changes are Ask me first.

var fs = require("fs");
var path = require("path");
var child = require("child_process");

var ROOT = path.join(__dirname, "..");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split("\n").forEach(function (line) {
    var trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === "#") return;
    var eq = trimmed.indexOf("=");
    if (eq < 1) return;
    var key = trimmed.slice(0, eq).trim();
    if (process.env[key]) return;
    var value = trimmed.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  });
}

function migrationFiles(dir) {
  return fs.readdirSync(dir).filter(function (name) {
    return name.endsWith(".sql");
  }).sort();
}

function pendingFiles(files, applied) {
  var done = {};
  (applied || []).forEach(function (version) { done[version] = true; });
  return files.filter(function (name) { return !done[name]; });
}

function psql(url, args) {
  var result = child.spawnSync("psql", [url, "-v", "ON_ERROR_STOP=1"].concat(args), {
    encoding: "utf8"
  });
  if (result.error && result.error.code === "ENOENT") {
    return { ok: false, reason: "psql_missing" };
  }
  if (result.status !== 0) return { ok: false, reason: "psql_failed" };
  return { ok: true, stdout: result.stdout || "" };
}

function appliedVersions(url) {
  var ready = psql(url, ["-c", "create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now());"]);
  if (!ready.ok) return ready;
  var listed = psql(url, ["-t", "-A", "-c", "select version from schema_migrations order by version;"]);
  if (!listed.ok) return listed;
  return {
    ok: true,
    applied: listed.stdout.split("\n").map(function (line) { return line.trim(); }).filter(Boolean)
  };
}

function main() {
  loadEnv(path.join(ROOT, ".env"));
  var dir = path.join(ROOT, "migrations");
  var files = migrationFiles(dir);
  var url = process.env.DATABASE_URL;
  if (process.env.MEDFINDER_DATABASE === "production") {
    console.log("Refusing to change the production database. Ask first.");
    return 0;
  }
  if (!url) {
    console.log("DATABASE_URL is unset. Migrations were not applied.");
    return 0;
  }
  var current = appliedVersions(url);
  if (!current.ok && current.reason === "psql_missing") {
    console.error("psql is not installed, so the migration files were not applied.");
    return 1;
  }
  if (!current.ok) {
    console.error("The migration table could not be read.");
    return 1;
  }
  var pending = pendingFiles(files, current.applied);
  for (var i = 0; i < pending.length; i += 1) {
    if (!/^[0-9A-Za-z_.-]+\.sql$/.test(pending[i])) {
      console.error("Unexpected migration name: " + pending[i]);
      return 1;
    }
    var file = path.join(dir, pending[i]);
    var result = psql(url, ["-f", file]);
    if (!result.ok) {
      console.error("Migration failed: " + pending[i]);
      return 1;
    }
    var mark = psql(url, ["-c", "insert into schema_migrations (version) values ('" + pending[i].replace(/'/g, "") + "');"]);
    if (!mark.ok) {
      console.error("Could not record " + pending[i]);
      return 1;
    }
    console.log("Applied " + pending[i]);
  }
  console.log("Applied " + pending.length + " migration file" + (pending.length === 1 ? "" : "s") + ".");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = {
  migrationFiles: migrationFiles,
  pendingFiles: pendingFiles,
  main: main
};
