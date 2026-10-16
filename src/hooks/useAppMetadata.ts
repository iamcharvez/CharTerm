import { useEffect, useState } from "react";
import { getAppMetadata, type AppMetadata } from "../lib/appMetadata";

const initialMetadata: AppMetadata = {
  name: __APP_NAME__,
  version: __APP_VERSION__,
  source: "build",
};

export function useAppMetadata() {
  const [metadata, setMetadata] = useState(initialMetadata);

  useEffect(() => {
    let mounted = true;
    void getAppMetadata().then((next) => {
      if (mounted) setMetadata(next);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return metadata;
}

