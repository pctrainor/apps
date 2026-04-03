import { useCallback, useState } from "react";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Button,
  Card,
  FormLayout,
  Layout,
  Page,
  TextField,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

const BACKEND_URL = process.env.BACKEND_API_URL || "http://localhost:4000";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const to = url.searchParams.get("to") || "";
  return json({ to });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const toShop = formData.get("toShop")?.toString().trim();
  const subject = formData.get("subject")?.toString().trim();
  const body = formData.get("body")?.toString().trim();

  const errors = {};
  if (!toShop) errors.toShop = "Recipient shop domain is required";
  if (!body) errors.body = "Message body is required";
  if (Object.keys(errors).length) return json({ errors }, { status: 400 });

  const res = await fetch(`${BACKEND_URL}/api/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shop-domain": session.shop,
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ toShop, subject, body }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return json(
      { errors: { form: err.error || "Failed to send message" } },
      { status: 500 }
    );
  }

  return redirect("/app/inbox");
};

export default function Compose() {
  const { to } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const errors = actionData?.errors || {};

  const [toShop, setToShop] = useState(to);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  return (
    <Page title="Compose Message" backAction={{ url: "/app/inbox" }}>
      <Layout>
        <Layout.Section>
          {errors.form && (
            <Banner tone="critical">
              <p>{errors.form}</p>
            </Banner>
          )}
          <Card>
            <Form method="post">
              <FormLayout>
                <TextField
                  label="To (shop domain)"
                  name="toShop"
                  placeholder="other-store.myshopify.com"
                  value={toShop}
                  onChange={setToShop}
                  error={errors.toShop}
                  autoComplete="off"
                />
                <TextField
                  label="Subject"
                  name="subject"
                  value={subject}
                  onChange={setSubject}
                  autoComplete="off"
                />
                <TextField
                  label="Message"
                  name="body"
                  value={body}
                  onChange={setBody}
                  multiline={6}
                  error={errors.body}
                  autoComplete="off"
                />
                <Button submit variant="primary" loading={isSubmitting}>
                  Send Message
                </Button>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
