"""Validate full searchable receipt content after the Electron render check."""
from pathlib import Path
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]/"outputs/qa-receipt-checks/after"
for name,count in [("58-2",2),("80-2",2),("80-200",200),("a4-100",100)]:
    reader=PdfReader(root/(name+".pdf"))
    text=" ".join(" ".join(page.extract_text() for page in reader.pages).split())
    missing=[i for i in range(1,count+1) if "QA "+str(i).zfill(3) not in text]
    assert not missing,(name,missing)
    assert "FIM DO RECIBO QA" in text,(name,"footer missing")
    print("PASS",name,":",len(reader.pages),"page(s); all",count,"items and footer preserved")
