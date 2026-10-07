use crate::programming_process::{run, Output};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

type Result<T> = std::result::Result<T, String>;
const LIMIT: usize = 8000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    id: String,
    name: String,
    languages: Vec<String>,
    executable: String,
    directory: String,
    version: String,
    #[serde(skip)]
    engine: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    environments: Vec<Environment>,
    search_directories: Vec<String>,
    working_directory: String,
}
#[derive(Default)]
pub struct ProgrammingManager {
    inventory: Mutex<Option<Inventory>>,
    jobs: Mutex<Jobs>,
}
#[derive(Default)]
struct Jobs {
    active: HashMap<String, Arc<AtomicBool>>,
    cancelled: HashMap<String, Instant>,
}
impl Jobs {
    fn register(&mut self, id: &str, flag: Arc<AtomicBool>) -> Result<()> {
        self.cancelled
            .retain(|_, at| at.elapsed() < Duration::from_secs(60));
        if self.cancelled.remove(id).is_some() {
            return Err("已取消代码执行。".into());
        }
        if self.active.len() >= 4 || self.active.contains_key(id) {
            return Err("运行任务较多，请稍后重试。".into());
        }
        self.active.insert(id.into(), flag);
        Ok(())
    }
    fn cancel(&mut self, id: String) {
        if let Some(flag) = self.active.get(&id) {
            flag.store(true, Ordering::SeqCst);
        } else {
            self.cancelled
                .retain(|_, at| at.elapsed() < Duration::from_secs(60));
            if self.cancelled.len() < 256 {
                self.cancelled.insert(id, Instant::now());
            }
        }
    }
}
impl ProgrammingManager {
    pub fn shutdown(&self) {
        if let Ok(jobs) = self.jobs.lock() {
            for flag in jobs.active.values() {
                flag.store(true, Ordering::SeqCst);
            }
        }
    }
}
struct Profile {
    engine: &'static str,
    names: &'static [&'static str],
    languages: &'static [&'static str],
    version_arg: &'static str,
}
const PROFILES: &[Profile] = &[
    Profile {
        engine: "Node.js",
        names: &["node", "nodejs"],
        languages: &["javascript"],
        version_arg: "--version",
    },
    Profile {
        engine: "Bun",
        names: &["bun"],
        languages: &["javascript", "typescript"],
        version_arg: "--version",
    },
    Profile {
        engine: "Deno",
        names: &["deno"],
        languages: &["javascript", "typescript"],
        version_arg: "--version",
    },
    Profile {
        engine: "Python",
        names: &["python3", "python"],
        languages: &["python"],
        version_arg: "--version",
    },
    Profile {
        engine: "Java",
        names: &["javac"],
        languages: &["java"],
        version_arg: "-version",
    },
    Profile {
        engine: "C",
        names: &["clang", "gcc", "cc"],
        languages: &["c"],
        version_arg: "--version",
    },
    Profile {
        engine: "C++",
        names: &["clang++", "g++", "c++"],
        languages: &["cpp"],
        version_arg: "--version",
    },
    Profile {
        engine: "Go",
        names: &["go"],
        languages: &["go"],
        version_arg: "version",
    },
    Profile {
        engine: "Rust",
        names: &["rustc"],
        languages: &["rust"],
        version_arg: "--version",
    },
    Profile {
        engine: "Ruby",
        names: &["ruby"],
        languages: &["ruby"],
        version_arg: "--version",
    },
    Profile {
        engine: "PHP",
        names: &["php"],
        languages: &["php"],
        version_arg: "--version",
    },
    Profile {
        engine: "Swift",
        names: &["swiftc"],
        languages: &["swift"],
        version_arg: "--version",
    },
    Profile {
        engine: "Kotlin",
        names: &["kotlinc"],
        languages: &["kotlin"],
        version_arg: "-version",
    },
    Profile {
        engine: "Bash",
        names: &["bash"],
        languages: &["shell"],
        version_arg: "--version",
    },
    Profile {
        engine: "PowerShell",
        names: &["pwsh"],
        languages: &["powershell"],
        version_arg: "--version",
    },
    Profile {
        engine: "Lua",
        names: &["lua", "lua5.4", "lua5.3"],
        languages: &["lua"],
        version_arg: "-v",
    },
    Profile {
        engine: "Perl",
        names: &["perl"],
        languages: &["perl"],
        version_arg: "-v",
    },
    Profile {
        engine: "R",
        names: &["Rscript"],
        languages: &["r"],
        version_arg: "--version",
    },
    Profile {
        engine: ".NET SDK",
        names: &["dotnet"],
        languages: &["csharp"],
        version_arg: "--version",
    },
];

fn executable_name(name: &str) -> String {
    if cfg!(windows) {
        name.trim_end_matches(".exe").to_owned() + ".exe"
    } else {
        name.into()
    }
}
fn executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .is_ok_and(|m| m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    true
}
fn add_directory(dirs: &mut Vec<PathBuf>, path: PathBuf) {
    if path.is_absolute() && path.is_dir() && !dirs.contains(&path) {
        dirs.push(path);
    }
}
fn search_directories(extra: Vec<String>) -> Result<Vec<PathBuf>> {
    if extra.len() > 32 {
        return Err("最多添加 32 个环境目录。".into());
    }
    let mut dirs = Vec::new();
    for raw in extra {
        let path = PathBuf::from(raw);
        if !path.is_absolute() {
            return Err("环境目录必须使用绝对路径。".into());
        }
        add_directory(&mut dirs, path.clone());
        add_directory(&mut dirs, path.join("bin"));
        add_directory(&mut dirs, path.join("Scripts"));
    }
    if let Some(path) = env::var_os("PATH") {
        for path in env::split_paths(&path) {
            add_directory(&mut dirs, path);
        }
    }
    // GUI applications often inherit a shorter PATH than an interactive login shell.
    #[cfg(unix)]
    if let Some(shell) = env::var_os("SHELL")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute() && executable(p))
    {
        if let Ok(out) = run(
            &shell,
            &[
                "-ilc".into(),
                "printf '\\n__AI_PLAYER_PATH__%s\\n' \"$PATH\"".into(),
            ],
            &env::temp_dir(),
            "",
            Duration::from_secs(3),
            &AtomicBool::new(false),
            None,
        ) {
            if let Some(path) = out
                .stdout
                .lines()
                .find_map(|line| line.strip_prefix("__AI_PLAYER_PATH__"))
            {
                for path in env::split_paths(path) {
                    add_directory(&mut dirs, path);
                }
            }
        }
    }
    for base in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/opt/local/bin",
        "/usr/local/go/bin",
    ] {
        add_directory(&mut dirs, PathBuf::from(base));
    }
    if let Some(home) = env::var_os("HOME").or_else(|| env::var_os("USERPROFILE")) {
        let home = PathBuf::from(home);
        for relative in [
            ".cargo/bin",
            ".local/bin",
            ".bun/bin",
            ".deno/bin",
            ".pyenv/shims",
            ".asdf/shims",
            ".volta/bin",
            "miniconda3/bin",
            "anaconda3/bin",
            ".dotnet",
            ".sdkman/candidates/java/current/bin",
            ".sdkman/candidates/kotlin/current/bin",
        ] {
            add_directory(&mut dirs, home.join(relative));
        }
    }
    for key in ["JAVA_HOME", "GOROOT", "DOTNET_ROOT"] {
        if let Some(base) = env::var_os(key) {
            add_directory(&mut dirs, PathBuf::from(&base).join("bin"));
            add_directory(&mut dirs, PathBuf::from(base));
        }
    }
    #[cfg(windows)]
    {
        for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Some(base) = env::var_os(key) {
                for relative in [
                    "nodejs",
                    "Go/bin",
                    "dotnet",
                    "PowerShell/7",
                    "Microsoft/WindowsApps",
                ] {
                    add_directory(&mut dirs, PathBuf::from(&base).join(relative));
                }
            }
        }
    }
    Ok(dirs)
}

fn node_typescript(version: &str) -> bool {
    let mut parts = version
        .trim_start_matches('v')
        .split('.')
        .filter_map(|part| part.parse::<u32>().ok());
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    major >= 24 || (major == 23 && minor >= 6) || (major == 22 && minor >= 18)
}

fn detect_profile(profile: &Profile, dirs: &[PathBuf]) -> Vec<Environment> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();
    let joined = env::join_paths(dirs).ok();
    for dir in dirs {
        for name in profile.names {
            let path = dir.join(executable_name(name));
            if !executable(&path) {
                continue;
            }
            let canonical = fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if !seen.insert(canonical) {
                continue;
            }
            if (profile.engine == "Java" && !executable(&dir.join(executable_name("java"))))
                || (profile.engine == "Kotlin" && !executable(&dir.join(executable_name("kotlin"))))
            {
                continue;
            }
            let Ok(out) = run(
                &path,
                &[profile.version_arg.into()],
                &env::temp_dir(),
                "",
                Duration::from_secs(3),
                &AtomicBool::new(false),
                joined.as_deref(),
            ) else {
                continue;
            };
            if !out.success || out.timed_out || out.overflow {
                continue;
            }
            let version = format!("{}\n{}", out.stdout, out.stderr)
                .lines()
                .find(|line| !line.trim().is_empty())
                .unwrap_or("")
                .chars()
                .take(250)
                .collect::<String>();
            if version.is_empty()
                || (profile.engine == "Python" && !version.starts_with("Python 3."))
            {
                continue;
            }
            if profile.engine == ".NET SDK"
                && version
                    .split('.')
                    .next()
                    .and_then(|v| v.parse::<u32>().ok())
                    .is_none_or(|v| v < 6)
            {
                continue;
            }
            let mut languages: Vec<String> =
                profile.languages.iter().map(|v| (*v).into()).collect();
            if profile.engine == "Node.js" && node_typescript(&version) {
                languages.push("typescript".into());
            }
            found.push(Environment {
                id: format!("{}:{}", profile.engine, path.display()),
                name: profile.engine.into(),
                languages,
                executable: path.to_string_lossy().into(),
                directory: dir.to_string_lossy().into(),
                version,
                engine: profile.engine.into(),
            });
        }
    }
    found
}
fn discover(extra: Vec<String>, working_directory: PathBuf) -> Result<Inventory> {
    let dirs = search_directories(extra)?;
    fs::create_dir_all(&working_directory).map_err(|e| e.to_string())?;
    let environments = std::thread::scope(|scope| {
        let jobs: Vec<_> = PROFILES
            .iter()
            .map(|profile| {
                let dirs = &dirs;
                scope.spawn(move || detect_profile(profile, dirs))
            })
            .collect();
        jobs.into_iter()
            .flat_map(|job| job.join().unwrap_or_default())
            .collect()
    });
    Ok(Inventory {
        environments,
        search_directories: dirs.iter().map(|p| p.to_string_lossy().into()).collect(),
        working_directory: working_directory.to_string_lossy().into(),
    })
}
#[tauri::command]
pub async fn programming_environments(
    app: tauri::AppHandle,
    extra_directories: Vec<String>,
) -> Result<Inventory> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("programming");
        let inventory = discover(extra_directories, directory)?;
        *app.state::<ProgrammingManager>()
            .inventory
            .lock()
            .map_err(|e| e.to_string())? = Some(inventory.clone());
        Ok(inventory)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn choose_programming_directory(app: tauri::AppHandle) -> Result<Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("选择编程环境目录")
            .blocking_pick_folder()
            .map(|file| {
                file.into_path()
                    .map(|p| p.to_string_lossy().into_owned())
                    .map_err(|e| e.to_string())
            })
            .transpose()
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    code: String,
    language: String,
    function_name: String,
    mode: String,
    tests: Vec<Test>,
}
#[derive(Deserialize)]
pub struct Test {
    id: String,
    args: Vec<Value>,
    expected: Value,
}
fn limited(value: &str, count: usize) -> String {
    value
        .chars()
        .scan(0, |length, ch| {
            *length += ch.len_utf16();
            (*length <= count).then_some(ch)
        })
        .collect()
}
fn valid_json(value: &Value, depth: usize) -> bool {
    if depth > 20 {
        return false;
    }
    match value {
        Value::Array(items) => {
            items.len() <= 1000 && items.iter().all(|v| valid_json(v, depth + 1))
        }
        Value::Object(items) => {
            items.len() <= 1000 && items.values().all(|v| valid_json(v, depth + 1))
        }
        _ => true,
    }
}
fn validate(input: &Execution) -> Result<()> {
    if input.code.encode_utf16().count() > 32000
        || !matches!(input.mode.as_str(), "test" | "run")
        || input.tests.is_empty()
        || input.tests.len() > 12
        || (input.mode == "run" && input.tests.len() != 1)
        || input.function_name.is_empty()
        || input.function_name.len() > 80
        || !input.function_name.bytes().enumerate().all(|(i, c)| {
            c.is_ascii_alphabetic() || c == b'_' || c == b'$' || (i > 0 && c.is_ascii_digit())
        })
        || input.tests.iter().any(|t| {
            t.id.is_empty()
                || t.id.len() > 240
                || t.args.len() > 12
                || !valid_json(&json!(t.args), 0)
                || !valid_json(&t.expected, 0)
                || json!([t.args, t.expected]).to_string().chars().count() > 6000
        })
        || input
            .tests
            .iter()
            .map(|t| &t.id)
            .collect::<HashSet<_>>()
            .len()
            != input.tests.len()
    {
        return Err("代码或测试用例格式无效。".into());
    }
    Ok(())
}
struct Program {
    command: PathBuf,
    args: Vec<String>,
    compile: Option<(PathBuf, Vec<String>)>,
}
fn prepare(environment: &Environment, input: &Execution, directory: &Path) -> Result<Program> {
    let executable = PathBuf::from(&environment.executable);
    let mut program = Program {
        command: executable.clone(),
        args: Vec::new(),
        compile: None,
    };
    let binary = directory.join(executable_name("solution"));
    let mut source = input.code.clone();
    let file = match input.language.as_str() {
        "javascript" | "typescript" => {
            // Input is data on stdin; expected answers never enter the guest process.
            let read = if environment.engine == "Deno" {
                "new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer())"
            } else {
                "require('node:fs').readFileSync(0, 'utf8')"
            };
            source.push_str(&format!("\n;{{ const __args = JSON.parse({read}); const __result = {}(...__args); if (__result === undefined || (__result && typeof __result.then === 'function')) throw new Error('请同步返回 JSON 值'); console.log(JSON.stringify(__result, (_key, value) => {{ if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('请返回有效的 JSON 值'); return value; }})); }}\n", input.function_name));
            if environment.engine == "Deno" {
                program
                    .args
                    .extend(["run".into(), "--quiet".into(), "--no-check".into()]);
            }
            if input.language == "typescript" {
                "solution.ts"
            } else if environment.engine == "Deno" {
                "solution.js"
            } else {
                "solution.cjs"
            }
        }
        "python" => {
            source.push_str(&format!("\nif __name__ == '__main__':\n    import json as __json, sys as __sys\n    __args = __json.loads(__sys.stdin.read())\n    print(__json.dumps({}(*__args), ensure_ascii=False, allow_nan=False))\n", input.function_name));
            program.args.push("-u".into());
            "solution.py"
        }
        "java" => {
            program.compile = Some((
                executable,
                vec!["-encoding".into(), "UTF-8".into(), "Main.java".into()],
            ));
            program.command = PathBuf::from(&environment.directory).join(executable_name("java"));
            program.args = vec!["-Xmx128m".into(), "-cp".into(), ".".into(), "Main".into()];
            "Main.java"
        }
        "c" | "cpp" => {
            let file = if input.language == "c" {
                "solution.c"
            } else {
                "solution.cpp"
            };
            program.compile = Some((
                executable,
                vec![
                    file.into(),
                    if input.language == "c" {
                        "-std=c11".into()
                    } else {
                        "-std=c++17".into()
                    },
                    "-o".into(),
                    binary.to_string_lossy().into(),
                ],
            ));
            program.command = binary;
            file
        }
        "rust" => {
            program.compile = Some((
                executable,
                vec![
                    "--edition=2021".into(),
                    "solution.rs".into(),
                    "-o".into(),
                    binary.to_string_lossy().into(),
                ],
            ));
            program.command = binary;
            "solution.rs"
        }
        "go" => {
            program.compile = Some((
                executable,
                vec![
                    "build".into(),
                    "-o".into(),
                    binary.to_string_lossy().into(),
                    "solution.go".into(),
                ],
            ));
            program.command = binary;
            "solution.go"
        }
        "kotlin" => {
            let java = PathBuf::from(&environment.directory).join(executable_name("kotlin"));
            program.compile = Some((
                executable,
                vec!["Main.kt".into(), "-d".into(), "classes".into()],
            ));
            program.command = java;
            program.args = vec!["-classpath".into(), "classes".into(), "MainKt".into()];
            "Main.kt"
        }
        "csharp" => {
            let major = environment
                .version
                .split('.')
                .next()
                .and_then(|v| v.parse::<u32>().ok())
                .ok_or(".NET SDK 版本无效")?;
            fs::write(directory.join("solution.csproj"), format!("<Project Sdk=\"Microsoft.NET.Sdk\"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net{major}.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>")).map_err(|e| e.to_string())?;
            // Prevent restore from reaching package sources; exercises use the installed SDK only.
            fs::write(
                directory.join("NuGet.Config"),
                "<configuration><packageSources><clear /></packageSources></configuration>",
            )
            .map_err(|e| e.to_string())?;
            program.compile = Some((
                executable,
                vec![
                    "build".into(),
                    "solution.csproj".into(),
                    "--nologo".into(),
                    "-o".into(),
                    "out".into(),
                ],
            ));
            program.args = vec!["out/solution.dll".into()];
            "Program.cs"
        }
        "ruby" => "solution.rb",
        "php" => "solution.php",
        "swift" => {
            program.compile = Some((
                executable,
                vec![
                    "solution.swift".into(),
                    "-o".into(),
                    binary.to_string_lossy().into(),
                ],
            ));
            program.command = binary;
            "solution.swift"
        }
        "shell" => "solution.sh",
        "lua" => "solution.lua",
        "perl" => "solution.pl",
        "r" => "solution.r",
        "powershell" => {
            program
                .args
                .extend(["-NoLogo".into(), "-NoProfile".into(), "-File".into()]);
            "solution.ps1"
        }
        _ => return Err("该语言尚无可用的运行环境。".into()),
    };
    fs::write(directory.join(file), source).map_err(|e| e.to_string())?;
    if program.compile.is_none() {
        program.args.push(file.into());
    }
    Ok(program)
}
fn failure(out: &Output) -> (&'static str, String) {
    if out.timed_out {
        ("timeout", "执行超过时限，请检查循环或递归。".into())
    } else if out.overflow {
        ("error", "运行输出超过限制。".into())
    } else {
        (
            "error",
            limited(format!("{}\n{}", out.stderr, out.stdout).trim(), 4000),
        )
    }
}
fn execute(
    environment: &Environment,
    inventory: &Inventory,
    input: Execution,
    cancelled: &AtomicBool,
) -> Result<Value> {
    validate(&input)?;
    if !environment.languages.contains(&input.language) {
        return Err("所选环境不支持这道题的语言。".into());
    }
    let temp = tempfile::Builder::new()
        .prefix("run-")
        .tempdir_in(&inventory.working_directory)
        .map_err(|e| e.to_string())?;
    let program = prepare(environment, &input, temp.path())?;
    let joined = env::join_paths(&inventory.search_directories).map_err(|e| e.to_string())?;
    let compilation = if let Some((command, args)) = &program.compile {
        let out = run(
            command,
            args,
            temp.path(),
            "",
            Duration::from_secs(if input.language == "swift" { 90 } else { 30 }),
            cancelled,
            Some(&joined),
        )?;
        if out.success && !out.overflow {
            None
        } else {
            Some(if out.timed_out {
                ("timeout", "编译超过时限，请检查代码或重试。".into())
            } else {
                failure(&out)
            })
        }
    } else {
        None
    };
    let mut cases = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(15);
    for (index, test) in input.tests.iter().enumerate() {
        if cancelled.load(Ordering::SeqCst) {
            return Err("已取消代码执行。".into());
        }
        let start = Instant::now();
        let mut result = json!({ "id": test.id, "status": "error", "actual": "", "output": "", "error": "", "durationMs": 0 });
        if let Some((status, error)) = &compilation {
            result["status"] = json!(status);
            result["error"] = json!(error);
        } else if start >= deadline {
            result["status"] = json!("timeout");
            result["error"] = json!("本次测试已达到执行时限。");
        } else {
            // Separate working directories keep files and process state from leaking between cases.
            let directory = temp.path().join(format!("case-{index}"));
            fs::create_dir(&directory).map_err(|e| e.to_string())?;
            for file in fs::read_dir(temp.path()).map_err(|e| e.to_string())? {
                let file = file.map_err(|e| e.to_string())?;
                if file.file_type().map_err(|e| e.to_string())?.is_file() {
                    fs::copy(file.path(), directory.join(file.file_name()))
                        .map_err(|e| e.to_string())?;
                }
            }
            let args = if input.language == "csharp" {
                vec![temp
                    .path()
                    .join("out/solution.dll")
                    .to_string_lossy()
                    .into()]
            } else if input.language == "kotlin" {
                vec![
                    "-classpath".into(),
                    temp.path().join("classes").to_string_lossy().into(),
                    "MainKt".into(),
                ]
            } else {
                program.args.clone()
            };
            let timeout = Duration::from_secs(3).min(deadline.saturating_duration_since(start));
            match run(
                &program.command,
                &args,
                &directory,
                &format!("{}\n", json!(test.args)),
                timeout,
                cancelled,
                Some(&joined),
            ) {
                Err(error) => result["error"] = json!(error),
                Ok(out) if !out.success || out.overflow => {
                    let (status, error) = failure(&out);
                    result["status"] = json!(status);
                    result["error"] = json!(error);
                    result["output"] = json!(limited(&out.stdout, LIMIT));
                }
                Ok(out) => {
                    let stdout = out.stdout.trim_end();
                    let (logs, last) = stdout.rsplit_once('\n').unwrap_or(("", stdout));
                    result["output"] =
                        json!(limited(format!("{logs}\n{}", out.stderr).trim(), LIMIT));
                    match serde_json::from_str::<Value>(last.trim()) {
                        Ok(actual)
                            if last.encode_utf16().count() <= LIMIT && valid_json(&actual, 0) =>
                        {
                            result["actual"] = json!(last.trim());
                            result["status"] = json!(if json_equal(&actual, &test.expected) {
                                "passed"
                            } else {
                                "failed"
                            });
                        }
                        _ => result["error"] = json!("请在最后一行输出有效的 JSON 结果。"),
                    }
                }
            }
        }
        result["durationMs"] = json!(start.elapsed().as_millis() as u64);
        cases.push(result);
    }
    if cancelled.load(Ordering::SeqCst) {
        return Err("已取消代码执行。".into());
    }
    Ok(
        json!({ "version": 1, "code": input.code, "mode": input.mode, "at": SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64, "cases": cases }),
    )
}
fn json_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| json_equal(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(k, a)| b.get(k).is_some_and(|b| json_equal(a, b)))
        }
        _ => a == b,
    }
}
#[tauri::command]
pub async fn run_programming(
    app: tauri::AppHandle,
    run_id: String,
    environment_id: String,
    input: Execution,
) -> Result<Value> {
    validate(&input)?;
    if uuid::Uuid::parse_str(&run_id).is_err() {
        return Err("运行编号无效。".into());
    }
    // Remember early cancellations too: IPC dispatch and async scheduling may reorder requests.
    let manager = app.state::<ProgrammingManager>();
    let inventory = manager
        .inventory
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or("请先检测本机编程环境。")?;
    let environment = inventory
        .environments
        .iter()
        .find(|e| e.id == environment_id)
        .cloned()
        .ok_or("运行环境已改变，请在设置中重新检测。")?;
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = manager.jobs.lock().map_err(|e| e.to_string())?;
        jobs.register(&run_id, cancelled.clone())?;
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        execute(&environment, &inventory, input, &cancelled)
    })
    .await
    .map_err(|e| e.to_string());
    manager
        .jobs
        .lock()
        .map_err(|e| e.to_string())?
        .active
        .remove(&run_id);
    result?
}
#[tauri::command]
pub fn cancel_programming(state: tauri::State<ProgrammingManager>, run_id: String) -> Result<()> {
    if uuid::Uuid::parse_str(&run_id).is_err() {
        return Err("运行编号无效。".into());
    }
    state.jobs.lock().map_err(|e| e.to_string())?.cancel(run_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(language: &str, code: &str) -> Execution {
        Execution {
            code: code.into(),
            language: language.into(),
            function_name: "solve".into(),
            mode: "test".into(),
            tests: vec![
                Test {
                    id: "number".into(),
                    args: vec![json!(7)],
                    expected: json!(7),
                },
                Test {
                    id: "zero".into(),
                    args: vec![json!(0)],
                    expected: json!(0),
                },
            ],
        }
    }
    fn inventory(directory: &Path, dirs: &[PathBuf]) -> Inventory {
        Inventory {
            environments: vec![],
            search_directories: dirs.iter().map(|p| p.to_string_lossy().into()).collect(),
            working_directory: directory.to_string_lossy().into(),
        }
    }
    #[test]
    fn cancellation_before_dispatch_and_during_execution() {
        let mut jobs = Jobs::default();
        jobs.cancel("first".into());
        assert!(jobs
            .register("first", Arc::new(AtomicBool::new(false)))
            .is_err());
        let flag = Arc::new(AtomicBool::new(false));
        jobs.register("second", flag.clone()).unwrap();
        jobs.cancel("second".into());
        assert!(flag.load(Ordering::SeqCst));
    }
    #[test]
    fn native_validation_and_json_comparison() {
        assert!(validate(&input("python", "def solve(n): return n")).is_ok());
        assert!(node_typescript("v24.0.0"));
        assert!(node_typescript("v22.18.0"));
        assert!(!node_typescript("v22.17.0"));
        assert!(!node_typescript("v20.19.0"));
        let mut bad = input("python", "");
        bad.function_name = "solve();".into();
        assert!(validate(&bad).is_err());
        assert!(json_equal(
            &json!({"a": [1.0, 2], "b": true}),
            &json!({"b": true, "a": [1, 2.0]})
        ));
        assert!(!json_equal(&json!("1"), &json!(1)));
        assert_eq!(limited("😀😀a", 4), "😀😀");
        assert!(search_directories(vec!["relative".into()]).is_err());
    }
    #[test]
    fn installed_languages_compile_and_execute_real_inputs() {
        let dirs = search_directories(vec![]).unwrap();
        let root = tempfile::tempdir().unwrap();
        let inventory = inventory(root.path(), &dirs);
        let examples = [
            ("Node.js", "javascript", "function solve(n) { console.log('log'); return n; }"),
            ("Bun", "typescript", "function solve(n: number): number { return n; }"),
            ("Deno", "typescript", "function solve(n: number): number { return n; }"),
            ("Python", "python", "def solve(n):\n    print('log')\n    return n"),
            ("Java", "java", "import java.util.Scanner; public class Main { public static void main(String[] a) { String s = new Scanner(System.in).nextLine(); System.out.println(s.substring(1,s.length()-1)); } }"),
            ("C", "c", "#include <stdio.h>\nint main(void) { int n; if(scanf(\"[%d]\", &n) != 1) return 1; printf(\"%d\\n\", n); return 0; }"),
            ("C++", "cpp", "#include <iostream>\nint main() { char c; int n; std::cin >> c >> n; std::cout << n << std::endl; }"),
            ("Rust", "rust", "use std::io::{self, Read}; fn main() { let mut s = String::new(); io::stdin().read_to_string(&mut s).unwrap(); println!(\"{}\", s.trim().trim_start_matches('[').trim_end_matches(']')); }"),
            ("Go", "go", "package main\nimport (\"os\";\"encoding/json\")\nfunc main(){var a []int;json.NewDecoder(os.Stdin).Decode(&a);json.NewEncoder(os.Stdout).Encode(a[0])}"),
            ("Ruby", "ruby", "require 'json'\nputs JSON.generate(JSON.parse(STDIN.read)[0])"),
            ("PHP", "php", "<?php echo json_encode(json_decode(stream_get_contents(STDIN))[0]), PHP_EOL;"),
            ("Swift", "swift", "import Foundation\nlet a = try! JSONSerialization.jsonObject(with: readLine()!.data(using: .utf8)!) as! [Int]\nprint(a[0])"),
            ("Bash", "shell", "read -r value\nvalue=${value#\\[}\nprintf '%s\\n' \"${value%\\]}\""),
            ("Perl", "perl", "use JSON::PP; my $a = decode_json(<STDIN>); print encode_json($a->[0]), qq(\\n);"),
            ("Lua", "lua", "local value = io.read(); print(string.sub(value, 2, -2))"),
            ("R", "r", "value <- readLines(file('stdin'), n=1); cat(substr(value, 2, nchar(value)-1), '\\n')"),
            ("PowerShell", "powershell", "$a = [Console]::ReadLine() | ConvertFrom-Json; $a[0] | ConvertTo-Json -Compress"),
            ("Kotlin", "kotlin", "fun main() { println(readln().removePrefix(\"[\").removeSuffix(\"]\")) }"),
            (".NET SDK", "csharp", "using System.Text.Json; var a = JsonSerializer.Deserialize<int[]>(Console.ReadLine()!); Console.WriteLine(JsonSerializer.Serialize(a![0]));"),
        ];
        let mut count = 0;
        for (engine, language, code) in examples {
            let profile = PROFILES.iter().find(|p| p.engine == engine).unwrap();
            if let Some(environment) = detect_profile(profile, &dirs).first() {
                let result = execute(
                    environment,
                    &inventory,
                    input(language, code),
                    &AtomicBool::new(false),
                )
                .unwrap();
                for case in result["cases"].as_array().unwrap() {
                    assert_eq!(case["status"], "passed", "{engine}: {case}");
                }
                if engine == "Node.js" && environment.languages.contains(&"typescript".into()) {
                    let typescript = execute(
                        environment,
                        &inventory,
                        input(
                            "typescript",
                            "function solve(n: number): number { return n; }",
                        ),
                        &AtomicBool::new(false),
                    )
                    .unwrap();
                    assert!(
                        typescript["cases"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .all(|case| case["status"] == "passed"),
                        "{typescript}"
                    );
                }
                println!("verified {engine}: {}", environment.version);
                count += 1;
            }
        }
        println!("verified {count} installed engines");
        assert_eq!(
            fs::read_dir(root.path()).unwrap().count(),
            0,
            "run directories are cleaned up"
        );
    }
    #[cfg(unix)]
    #[test]
    fn discovery_handles_spaces_missing_and_duplicate_executables() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join("environment with spaces");
        fs::create_dir(&directory).unwrap();
        let node = directory.join("node");
        fs::write(&node, "#!/bin/sh\necho v24.0.0\n").unwrap();
        fs::set_permissions(&node, fs::Permissions::from_mode(0o755)).unwrap();
        symlink(&node, directory.join("nodejs")).unwrap();
        let dirs = vec![directory.clone(), directory.clone()];
        let found = detect_profile(&PROFILES[0], &dirs);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].executable, node.to_string_lossy());
        assert_eq!(found[0].version, "v24.0.0");
        fs::remove_file(node).unwrap();
        assert!(detect_profile(&PROFILES[0], &dirs).is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn process_timeouts_cancellation_and_output_limits() {
        let root = tempfile::tempdir().unwrap();
        let shell = Path::new("/bin/sh");
        let timeout = run(
            shell,
            &["-c".into(), "sleep 10 & wait".into()],
            root.path(),
            "",
            Duration::from_millis(80),
            &AtomicBool::new(false),
            None,
        )
        .unwrap();
        assert!(timeout.timed_out);
        let flag = Arc::new(AtomicBool::new(false));
        let other = flag.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(80));
            other.store(true, Ordering::SeqCst);
        });
        let start = Instant::now();
        assert!(run(
            shell,
            &["-c".into(), "sleep 10 & wait".into()],
            root.path(),
            "",
            Duration::from_secs(5),
            &flag,
            None
        )
        .is_err());
        assert!(start.elapsed() < Duration::from_secs(2));
        let flood = run(shell, &["-c".into(), "while :; do printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'; done".into()], root.path(), "", Duration::from_secs(2), &AtomicBool::new(false), None).unwrap();
        assert!(flood.overflow);
        assert!(flood.stdout.len() <= 65536);
    }
    #[test]
    fn python_errors_failure_and_per_case_state() {
        let dirs = search_directories(vec![]).unwrap();
        let profile = PROFILES.iter().find(|p| p.engine == "Python").unwrap();
        let Some(environment) = detect_profile(profile, &dirs).into_iter().next() else {
            return;
        };
        let root = tempfile::tempdir().unwrap();
        let inventory = inventory(root.path(), &dirs);
        for (code, status) in [
            ("def solve(n): return -1", "failed"),
            ("def solve(n): raise ValueError('bad input')", "error"),
            ("def solve(n): return float('nan')", "error"),
            ("def solve(n):\n    while True: pass", "timeout"),
        ] {
            let result = execute(
                &environment,
                &inventory,
                input("python", code),
                &AtomicBool::new(false),
            )
            .unwrap();
            assert_eq!(result["cases"][0]["status"], status, "{result}");
        }
        let result = execute(&environment, &inventory, input("python", "from pathlib import Path\ndef solve(n):\n    p = Path('state')\n    assert not p.exists()\n    p.write_text('hello')\n    return n"), &AtomicBool::new(false)).unwrap();
        assert!(result["cases"]
            .as_array()
            .unwrap()
            .iter()
            .all(|case| case["status"] == "passed"));
    }
}
