"""Internal worker: Node supplies allowlisted paths and validated codepoints."""
import sys
from fontTools import subset

if __name__ == "__main__":
    source, output, codepoints = sys.argv[1:]
    subset.main([source, "--output-file=" + output, "--unicodes=" + codepoints,
                 "--flavor=woff2", "--no-ignore-missing-unicodes", "--name-IDs=*",
                 "--name-languages=*", "--name-legacy", "--layout-features=*"])
