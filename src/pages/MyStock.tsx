import { useAuth } from "../components/AuthProvider";
import { useDesign } from "../components/design/DesignContext";
import { MerchantStockWorkspace } from "../components/merchant-stock/MerchantStockWorkspace";
import MyStockClassic from "./MyStockClassic";

export default function MyStock() {
  const { profile } = useAuth();
  const { mode } = useDesign();
  if (mode === "classic") return <MyStockClassic />;
  if (!profile?.company_id)
    return (
      <p role="status">
        Vincula tu cuenta a un comercio para consultar su stock.
      </p>
    );
  return (
    <MerchantStockWorkspace
      key={profile.company_id}
      companyId={profile.company_id}
    />
  );
}
