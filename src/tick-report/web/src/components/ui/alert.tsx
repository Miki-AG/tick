import * as React from "react";

import { cn } from "@/lib/utils";

function Alert({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="status"
      className={cn("w-full rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm", className)}
      {...props}
    />
  );
}

export { Alert };
