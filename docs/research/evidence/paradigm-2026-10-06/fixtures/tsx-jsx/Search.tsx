import {AddressForm} from "./Form";
export function Search() {
 return <AddressForm onSubmit={() => console.log("search")} />;
}
