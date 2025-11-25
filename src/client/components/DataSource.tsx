import { useState } from 'react';
import { SignInDialog } from './SignInDialog';
import type { BrandConfig } from '../modules/Config';
import {
  transformData,
  type PurchaseHistory,
} from '../modules/DataTransformSchema';
import * as Sentry from '@sentry/react';

interface DataSourceProps {
  onSuccessConnect: (data: PurchaseHistory[]) => void;
  disabled?: boolean;
  brandConfig: BrandConfig;
  isConnected?: boolean;
}

export function DataSource({
  onSuccessConnect,
  disabled,
  brandConfig,
  isConnected,
}: DataSourceProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [linkId, setLinkId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleConnect = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/internal/mcp/get-signin-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          brand_id: brandConfig.brand_id,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to retrieve data');
      }

      const data = result.data;

      if (data.url && data.link_id) {
        setLinkId(data.link_id);

        window.open(
          data.url,
          '_blank',
          'width=500,height=600,menubar=no,toolbar=no,location=no,status=no'
        );

        setIsDialogOpen(true);
        setIsLoading(false);
      } else if (data) {
        const transformedData = transformData(
          data,
          brandConfig.dataTransform
        ) as PurchaseHistory[];

        handleSuccessConnect(transformedData);
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (error) {
      console.error('DataSource connection error:', error);
      Sentry.captureException(error, {
        tags: {
          component: 'DataSource',
          brand_id: brandConfig.brand_id,
          brand_name: brandConfig.brand_name,
        },
        extra: {
          brandConfig,
        },
      });
      alert(
        `Failed to retrieve data: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setIsLoading(false);
    }
  };

  const onFinalizeSignin = ({
    signinId,
    brandId,
  }: {
    signinId: string;
    brandId: string;
  }) => {
    fetch('/internal/mcp/finalize-signin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        signin_id: signinId,
        brand_id: brandId,
      }),
    });
  };

  const handleSuccessConnect = (data: PurchaseHistory[]) => {
    setIsDialogOpen(false);
    setLinkId(null);
    setIsLoading(false);
    onSuccessConnect(data);

    if (linkId) {
      onFinalizeSignin({ signinId: linkId, brandId: brandConfig.brand_id });
    }
  };

  return (
    <>
      <div className="bg-white p-6 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8">
              <img
                src={brandConfig.logo_url}
                alt={`${brandConfig.brand_name} logo`}
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h3 className="font-medium">{brandConfig.brand_name}</h3>
              {brandConfig.is_mandatory && (
                <span className="text-xs text-gray-500">Required</span>
              )}
            </div>
          </div>
          {isConnected ? (
            <div className="px-4 py-2 flex items-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-4 text-green-700"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m4.5 12.75 6 6 9-13.5"
                />
              </svg>

              <span className="text-green-700 text-sm font-medium">
                Connected
              </span>
            </div>
          ) : (
            <button
              disabled={disabled || isLoading}
              onClick={handleConnect}
              className={`px-4 py-2 bg-black text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2 ${
                disabled || isConnected || isLoading
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              {isLoading ? (
                <>
                  <div className="inline-block animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
                  <span>Loading...</span>
                </>
              ) : (
                'Connect'
              )}
            </button>
          )}
        </div>
      </div>

      <SignInDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setLinkId(null);
        }}
        onSuccessConnect={handleSuccessConnect}
        brandConfig={brandConfig}
        linkId={linkId}
      />
    </>
  );
}
