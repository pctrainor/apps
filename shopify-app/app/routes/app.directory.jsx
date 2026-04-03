import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Card,
  EmptyState,
  Layout,
  Page,
  ResourceItem,
  ResourceList,
  Text,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const res = await fetch(`${BACKEND_URL}/api/merchants`, {
    headers: {
      "Content-Type": "application/json",
      "x-shop-domain": session.shop,
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  const data = res.ok ? await res.json() : { merchants: [] };
  return json({ merchants: data.merchants ?? [], currentShop: session.shop });
};

export default function Directory() {
  const { merchants, currentShop } = useLoaderData();
  const others = merchants.filter((m) => m.shopDomain !== currentShop);

  return (
    <Page title="Merchant Directory" backAction={{ url: "/app/inbox" }}>
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {others.length === 0 ? (
              <EmptyState
                heading="No other merchants yet"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  When other merchants install this app, they'll show up here
                  so you can message them.
                </p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "merchant", plural: "merchants" }}
                items={others}
                renderItem={(merchant) => (
                  <ResourceItem
                    id={merchant.id}
                    url={`/app/compose?to=${encodeURIComponent(merchant.shopDomain)}`}
                    accessibilityLabel={`Message ${merchant.shopDomain}`}
                  >
                    <Text variant="bodyMd" fontWeight="bold">
                      {merchant.shopDomain}
                    </Text>
                    {merchant.shopName && (
                      <Text variant="bodySm" tone="subdued">
                        {merchant.shopName}
                      </Text>
                    )}
                  </ResourceItem>
                )}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
