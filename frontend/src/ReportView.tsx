import { useRef } from "react";
import { Box, Button, Stack } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Shared by the on-screen view and the downloaded HTML file.
const REPORT_CSS = `
  .report { font-family: "Segoe UI", system-ui, sans-serif; line-height: 1.55; color: #1b2230; }
  .report h1 { font-size: 1.6rem; margin: 0 0 12px; }
  .report h2 { font-size: 1.15rem; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #dde2ea; }
  .report h3 { font-size: 1rem; margin: 16px 0 6px; }
  .report p, .report li { font-size: 0.95rem; }
  .report ul, .report ol { padding-left: 1.4rem; margin: 6px 0; }
  .report li { margin: 3px 0; }
  .report table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 0.9rem; }
  .report th, .report td { border: 1px solid #dde2ea; padding: 6px 10px; text-align: left; vertical-align: top; }
  .report th { background: #f1f4f8; font-weight: 600; }
  .report tr:nth-child(even) td { background: #fafbfc; }
  .report code { background: #f1f4f8; padding: 1px 5px; border-radius: 4px; }
  .report .table-wrap { overflow-x: auto; }
`;

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function slug(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "report";
}

export default function ReportView({ markdown, done }: { markdown: string; done: boolean }) {
  const body = useRef<HTMLDivElement>(null);
  const title = markdown.match(/^#\s+(.+)$/m)?.[1].replace(/[*_`]/g, "").trim() || "Recruiter briefing";

  function downloadHtml() {
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<style>body{margin:0;background:#f7f8fa}.page{max-width:900px;margin:32px auto;padding:32px;background:#fff;border:1px solid #dde2ea;border-radius:10px}${REPORT_CSS}</style>
</head><body><div class="page report">${body.current?.innerHTML ?? ""}</div></body></html>`;
    download(`${slug(title)}.html`, html, "text/html");
  }

  return (
    <Stack spacing={1.5}>
      <style>{REPORT_CSS}</style>
      <Box ref={body} className="report">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ table: ({ node: _node, ...props }) => <div className="table-wrap"><table {...props} /></div> }}
        >
          {markdown}
        </ReactMarkdown>
      </Box>
      {done && (
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="contained" onClick={downloadHtml}>Download report (.html)</Button>
          <Button size="small" variant="outlined" onClick={() => download(`${slug(title)}.md`, markdown, "text/markdown")}>
            Download (.md)
          </Button>
        </Stack>
      )}
    </Stack>
  );
}
