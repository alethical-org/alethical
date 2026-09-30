type Props = { columns: string[]; rows: string[][]; totalRow?: boolean };

/** HTML columns share their measured widths, including wide headings and values. */
export function ResearchBlockTable({ columns, rows, totalRow }: Props) {
  return (
    <div className="research-table-scroll" tabIndex={0} role="region" aria-label="Article table">
      <style>{tableCss}</style>
      <div className={`research-table-frame${totalRow ? ' research-table-final-total' : ''}`}>
        <table className="research-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th scope="col" key={column}>
                  {column}
                </th>
              ))}
              <td className="research-table-spacer" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={index}
                className={
                  totalRow && index === rows.length - 1 ? 'research-table-total' : undefined
                }
              >
                {row.map((value, cell) =>
                  cell === 0 ? (
                    <th scope="row" key={cell}>
                      {value}
                    </th>
                  ) : (
                    <td key={cell}>{value}</td>
                  ),
                )}
                <td className="research-table-spacer" aria-hidden="true" />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const tableCss = `
.research-table-scroll{margin-top:22px;max-width:100%;overflow-x:auto}.research-table-scroll:focus-visible{outline:2px solid #7c5cff;outline-offset:2px;border-radius:3px}
.research-table-frame{box-sizing:border-box;border:1px solid rgba(17,21,15,.08);border-radius:12px;overflow:hidden;min-width:100%;width:max-content}.research-table-final-total{border-bottom:0}
.research-table{width:100%;border-collapse:collapse;font-family:'Libre Franklin',Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums;color:#11150f}
.research-table th,.research-table td{box-sizing:border-box;padding:13px 16px;font-size:16px;line-height:24px;font-weight:400;text-align:left;border-top:1px solid rgba(17,21,15,.08)}
.research-table thead th,.research-table thead td{padding:12px 16px;background:#f7f8fa;border-top:0;color:#4f5651;font-size:11px;line-height:normal;font-weight:700;letter-spacing:.7px;text-transform:uppercase}
.research-table tr>:first-child{width:1%}.research-table tr>:not(:first-child):not(.research-table-spacer){width:1%;min-width:160px;text-align:right;white-space:nowrap}.research-table .research-table-spacer{width:auto;padding:0}.research-table-total th,.research-table-total td{font-weight:700}
@media(min-width:768px){.research-table tr>:first-child{white-space:nowrap}}
`;
