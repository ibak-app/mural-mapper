'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

// Redirect to the new editor route
export default function WallEditorPageRedirect() {
  const { projectId, wallId } = useParams<{ projectId: string; wallId: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/project/${projectId}/edit/${wallId}`);
  }, [projectId, wallId, router]);

  return <div className="text-center py-20 text-gray-400">Redirecting...</div>;
}
