const authjsHandler = {
  key: "authjs",
  value: "authjs",
  label: "Authjs (Next-Auth)",
  transformer: {
    id: "userId",
    email_addresses: "emailAddresses",
    first_name: "firstName",
    last_name: "lastName",
  },
};

export default authjsHandler;
