# Contoso Outdoor constitution

1. Shoppers never notice the migration. Same URLs, cookies, prices and checkout steps before, during and after every change.
2. Small, reversible steps. One route or one component per change, with the legacy path still available behind YARP.
3. The shared database is a contract. Neither app may change it in a way the other cannot read until cutover is decided.
4. No secrets in the repository. Identity-based access only.
