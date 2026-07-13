use std::path::Path;

#[test]
fn shipping_rust_files_stay_under_200_lines() {
    visit(Path::new("src"));
}

fn visit(path: &Path) {
    for entry in std::fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            visit(&path);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            let lines = std::fs::read_to_string(&path).unwrap().lines().count();
            assert!(lines < 200, "{} has {lines} lines", path.display());
        }
    }
}
