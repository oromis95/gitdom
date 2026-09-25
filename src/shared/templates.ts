// Starter files offered when creating a new repository (REPO-03).

export interface Template {
  id: string
  label: string
}

const GITIGNORE: Record<string, { label: string; content: string }> = {
  node: {
    label: 'Node',
    content: `node_modules/
dist/
build/
out/
coverage/
.env
.env.*
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
`
  },
  python: {
    label: 'Python',
    content: `__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/
.venv/
venv/
.env
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
`
  },
  java: {
    label: 'Java',
    content: `*.class
*.jar
*.war
*.ear
target/
build/
.gradle/
out/
.idea/
*.iml
`
  },
  dotnet: {
    label: '.NET',
    content: `bin/
obj/
*.user
*.suo
.vs/
*.nupkg
TestResults/
`
  },
  go: {
    label: 'Go',
    content: `*.exe
*.test
*.out
/bin/
vendor/
`
  },
  rust: {
    label: 'Rust',
    content: `target/
**/*.rs.bk
`
  },
  cpp: {
    label: 'C/C++',
    content: `*.o
*.obj
*.a
*.lib
*.so
*.dll
*.exe
build/
cmake-build-*/
CMakeCache.txt
CMakeFiles/
`
  }
}

// Editor and OS clutter, added to every .gitignore template
const COMMON_IGNORES = `
# Editors and OS
.vscode/
.idea/
*.swp
.DS_Store
Thumbs.db
`

const LICENSES: Record<string, { label: string; text: (year: number, holder: string) => string }> =
  {
    mit: {
      label: 'MIT',
      text: (year, holder) => `MIT License

Copyright (c) ${year} ${holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
    },
    isc: {
      label: 'ISC',
      text: (year, holder) => `ISC License

Copyright (c) ${year} ${holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`
    },
    'bsd-2-clause': {
      label: 'BSD 2-Clause',
      text: (year, holder) => `BSD 2-Clause License

Copyright (c) ${year}, ${holder}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`
    },
    unlicense: {
      label: 'Unlicense (public domain)',
      text: () => `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

In jurisdictions that recognize copyright laws, the author or authors
of this software dedicate any and all copyright interest in the
software to the public domain. We make this dedication for the benefit
of the public at large and to the detriment of our heirs and
successors. We intend this dedication to be an overt act of
relinquishment in perpetuity of all present and future rights to this
software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org>
`
    }
  }

export const GITIGNORE_TEMPLATES: Template[] = Object.entries(GITIGNORE).map(([id, t]) => ({
  id,
  label: t.label
}))

export const LICENSE_TEMPLATES: Template[] = Object.entries(LICENSES).map(([id, t]) => ({
  id,
  label: t.label
}))

/** Content of a .gitignore template; throws on an unknown id. */
export function gitignoreContent(id: string): string {
  const template = GITIGNORE[id]
  if (!template) throw new Error(`Unknown .gitignore template: ${id}`)
  return `# ${template.label}\n${template.content}${COMMON_IGNORES}`
}

/** Text of a license; throws on an unknown id. */
export function licenseText(id: string, year: number, holder: string): string {
  const license = LICENSES[id]
  if (!license) throw new Error(`Unknown license: ${id}`)
  return license.text(year, holder)
}

/**
 * Folder name git would pick when cloning `url`:
 * https://host/team/app.git, git@host:team/app and C:\repos\app all give "app".
 */
export function repoNameFromUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\.git$/i, '')
    .replace(/[\\/]+$/, '')
  const name = trimmed.split(/[\\/:]/).pop() ?? ''
  return name.replace(/[<>:"|?*]/g, '')
}
