import { useEffect, useRef, useState } from 'react';
import type { BrandConfig } from '../modules/Config';
import {
  transformData,
  type PurchaseHistory,
} from '../modules/DataTransformSchema';

interface SignInDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccessConnect: (data: PurchaseHistory[]) => void;
  brandConfig: BrandConfig;
  linkId: string | null;
}

type LoadingState = 'AUTHENTICATION' | 'RETRIEVING_DATA' | null;

const LOADING_STATE_MESSAGES = {
  AUTHENTICATION: {
    title: 'Authentication in Progress',
    message:
      'Please complete the authentication process in the opened tab to connect your account.',
    notes:
      'This dialog will close automatically when authentication is complete.',
  },
  RETRIEVING_DATA: {
    title: 'Retrieving data...',
    message: 'Please wait while we retrieve your data.',
    notes:
      'This dialog will close automatically when data retrieval is complete.',
  },
};

export function SignInDialog({
  isOpen,
  onClose,
  onSuccessConnect,
  brandConfig,
  linkId,
}: SignInDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      dialog.showModal();

      // Start polling for completion
      if (linkId && !isPolling) {
        setIsPolling(true);
        setPollingError(null);
        setLoadingState('AUTHENTICATION');
        // Poll for authentication completion
        const pollForAuth = async () => {
          let attempts = 0;
          const maxAttempts = 120; // 2 minute max

          while (attempts < maxAttempts) {
            try {
              const response = await fetch('/internal/mcp/signin-check', {
                method: 'POST',
                headers: {
                  accept: 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  link_id: linkId,
                  brand_id: brandConfig.brand_id,
                }),
              });

              if (response.ok) {
                const result = await response.json();

                if (result.success && result.data?.status === 'FINISHED') {
                  return { success: true, purchases: result.data?.purchases };
                }
              }
            } catch (error) {
              console.log('Polling attempt failed:', error);
            }

            attempts++;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          throw new Error('Authentication timed out. Please try again.');
        };
        pollForAuth()
          .then(({ purchases }) => {
            setLoadingState('RETRIEVING_DATA');
            // Transform the data on the client side
            const transformedData = transformData(
              { purchases },
              brandConfig.dataTransform
            ) as PurchaseHistory[];

            onSuccessConnect(transformedData);
            onClose();
            setLoadingState(null);
          })
          .catch((error) => {
            console.error('Authentication flow failed:', error);
            setPollingError(
              error.message || 'Authentication failed. Please try again.'
            );
            setIsPolling(false);
            setLoadingState(null);
          });
      }
    } else {
      dialog.close();
      setIsPolling(false);
      setPollingError(null);
      setLoadingState(null);
    }
  }, [isOpen, brandConfig, onSuccessConnect, onClose, linkId]);

  return (
    <dialog
      onClose={onClose}
      ref={dialogRef}
      className="m-0 p-0 bg-transparent w-full h-full max-w-full max-h-full"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
    >
      <div
        className="fixed inset-0 flex items-center justify-center p-4"
        onClick={onClose}
        style={{ zIndex: 0 }}
      >
        <div
          className="w-full max-w-md bg-white rounded-2xl p-6 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          style={{ zIndex: 1 }}
        >
          <div className="flex items-center justify-center mb-6">
            <img
              src={brandConfig.logo_url}
              alt={`${brandConfig.brand_name} logo`}
              className="h-8 w-auto"
            />
          </div>

          <h3 className="text-lg font-medium text-center leading-6 text-gray-900 mb-4">
            {loadingState ? LOADING_STATE_MESSAGES[loadingState].title : ''}
          </h3>
          <div className="text-center">
            {pollingError ? (
              <>
                <p className="text-red-600 mb-4">{pollingError}</p>
                <button
                  onClick={() => {
                    // Clear error and close
                    setPollingError(null);
                    setIsPolling(false);
                    onClose();
                  }}
                  className="px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-600 mb-4">
                  {loadingState
                    ? LOADING_STATE_MESSAGES[loadingState].message
                    : ''}
                </p>
                <p className="text-sm text-gray-500">
                  {loadingState
                    ? LOADING_STATE_MESSAGES[loadingState].notes
                    : ''}
                </p>
                {isPolling && (
                  <div className="mt-4">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}
