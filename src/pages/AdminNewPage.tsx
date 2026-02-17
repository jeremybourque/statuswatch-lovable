import { Activity, ArrowLeft, FileText, AlertTriangle } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

const AdminNewPage = () => {
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from");
  const backTo = from === "admin" ? "/admin" : "/";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center gap-3">
          <Activity className="h-7 w-7 text-primary" />
          <h1 className="text-xl font-bold text-foreground tracking-tight">What do you need?</h1>
          <Link to={backTo} className="ml-auto">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto">
          <Button
            variant="outline"
            className="h-auto py-8 flex flex-col items-center gap-3 text-base font-medium"
          >
            <FileText className="h-8 w-8 text-primary" />
            Clone my existing status page
          </Button>
          <Button
            variant="outline"
            className="h-auto py-8 flex flex-col items-center gap-3 text-base font-medium text-center whitespace-normal"
          >
            <AlertTriangle className="h-8 w-8 text-destructive" />
            <span>Need a status page for my active incident—<em>fast!</em></span>
          </Button>
        </div>
      </main>
    </div>
  );
};

export default AdminNewPage;
