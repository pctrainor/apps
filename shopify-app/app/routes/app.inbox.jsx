import { useCallback, useEffect, useState } from "react";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Divider,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  ResourceItem,
  ResourceList,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// ---- helpers ----
const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000";

async function backendFetch(path, shop, token) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      "x-shop-domain": shop,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    console.error(`Backend ${path} responded ${res.status}`);
    return null;
  }
  return res.json();
}

// ---- loader ----
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const token = session.accessToken;

  const [inbox, sent] = await Promise.all([
    backendFetch("/api/messages/inbox", shop, token),
    backendFetch("/api/messages/sent", shop, token),
  ]);

  return json({
    shop,
    inbox: inbox?.messages ?? [],
    sent: sent?.messages ?? [],
  });
};

// ---- action (mark as read) ----
export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const messageId = formData.get("messageId");
  const actionType = formData.get("_action");

  if (actionType === "markRead" && messageId) {
    await backendFetch(
      `/api/messages/${encodeURIComponent(messageId)}/read`,
      session.shop,
      session.accessToken
    );
  }

  return json({ ok: true });
};

// ---- component ----
export default function Inbox() {
  const { shop, inbox, sent } = useLoaderData();
  const fetcher = useFetcher();
  const [tab, setTab] = useState("inbox");

  const messages = tab === "inbox" ? inbox : sent;

  const markRead = useCallback(
    (id) => {
      fetcher.submit(
        { _action: "markRead", messageId: id },
        { method: "post" }
      );
    },
    [fetcher]
  );

  return (
    <Page
      title="Merchant Messages"
      subtitle={`Logged in as ${shop}`}
      primaryAction={{
        content: "Compose",
        url: "/app/compose",
      }}
      secondaryActions={[{ content: "Directory", url: "/app/directory" }]}
    >
      <Layout>
        <Layout.Section>
          <InlineStack gap="200">
            <Button
              pressed={tab === "inbox"}
              onClick={() => setTab("inbox")}
            >
              Inbox{" "}
              {inbox.filter((m) => !m.readAt).length > 0 && (
                <Badge tone="attention">
                  {inbox.filter((m) => !m.readAt).length}
                </Badge>
              )}
            </Button>
            <Button pressed={tab === "sent"} onClick={() => setTab("sent")}>
              Sent
            </Button>
          </InlineStack>
        </Layout.Section>

        <Layout.Section>
          <Card padding="0">
            {messages.length === 0 ? (
              <EmptyState
                heading={
                  tab === "inbox"
                    ? "No messages yet"
                    : "You haven't sent any messages"
                }
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>
                  {tab === "inbox"
                    ? "When other merchants message you, they'll appear here."
                    : "Compose a message to start a conversation."}
                </p>
              </EmptyState>
            ) : (
              <ResourceList
                resourceName={{ singular: "message", plural: "messages" }}
                items={messages}
                renderItem={(msg) => {
                  const isUnread = tab === "inbox" && !msg.readAt;
                  return (
                    <ResourceItem
                      id={msg.id}
                      onClick={() => {
                        if (isUnread) markRead(msg.id);
                      }}
                      accessibilityLabel={`Message from ${msg.fromShop}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <InlineStack gap="200" blockAlign="center">
                            <Text
                              variant="bodyMd"
                              fontWeight={isUnread ? "bold" : "regular"}
                            >
                              {tab === "inbox" ? msg.fromShop : msg.toShop}
                            </Text>
                            {isUnread && <Badge tone="info">New</Badge>}
                          </InlineStack>
                          <Text variant="bodySm" tone="subdued">
                            {msg.subject || "(no subject)"}
                          </Text>
                        </BlockStack>
                        <Text variant="bodySm" tone="subdued">
                          {new Date(msg.createdAt).toLocaleString()}
                        </Text>
                      </InlineStack>
                      <Box paddingBlockStart="100">
                        <Text variant="bodySm">
                          {msg.body.length > 140
                            ? msg.body.slice(0, 140) + "…"
                            : msg.body}
                        </Text>
                      </Box>
                    </ResourceItem>
                  );
                }}
              />
            )}
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
