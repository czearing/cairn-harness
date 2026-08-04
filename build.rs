use std::process::Command;

fn output(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|result| result.status.success())
        .map(|result| String::from_utf8_lossy(&result.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

fn main() {
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/index");
    println!(
        "cargo:rustc-env=HARNESS_GIT_SHA={}",
        output(&["rev-parse", "--short=12", "HEAD"])
    );
    let dirty = Command::new("git")
        .args(["diff", "--quiet", "--ignore-submodules", "HEAD"])
        .status()
        .is_ok_and(|status| !status.success());
    println!("cargo:rustc-env=HARNESS_GIT_DIRTY={}", u8::from(dirty));
}
