import { useState } from "react";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { json } from "@remix-run/node";
import {
  AppProvider,
  Button,
  Card,
  FormLayout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import polarisTranslations from "@shopify/polaris/locales/en.json";
import { login } from "../../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }) => {
  const errors = login(request);
  return json({ errors });
};

export const action = async ({ request }) => {
  const errors = login(request);
  return json({ errors });
};

export default function Auth() {
  const { errors } = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState("");
  const allErrors = { ...(errors || {}), ...(actionData?.errors || {}) };

  return (
    <AppProvider i18n={polarisTranslations}>
      <Page>
        <Card>
          <Form method="post">
            <FormLayout>
              <Text variant="headingLg" as="h2">
                Log in
              </Text>
              <TextField
                type="text"
                name="shop"
                label="Shop domain"
                helpText="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={allErrors.shop}
              />
              <Button submit>Log in</Button>
            </FormLayout>
          </Form>
        </Card>
      </Page>
    </AppProvider>
  );
}
