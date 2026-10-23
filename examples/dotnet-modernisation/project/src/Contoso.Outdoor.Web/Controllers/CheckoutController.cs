// Index is served by Contoso.Outdoor.Web.Core on the checkout feature branch; PlaceOrder, Pay and Confirm stay here for now.
[Authorize]
public class CheckoutController : Controller
{
    private readonly OutdoorContext db = new OutdoorContext();
    private readonly PaymentGateway payments = new PaymentGateway();

    public ActionResult Index() => View(Cart.From(Session));

    [HttpPost, ValidateAntiForgeryToken]
    public ActionResult Index(Address address)
    {
        if (!ModelState.IsValid) return View(Cart.From(Session));
        Session[SessionKeys.Address] = address;
        return RedirectToAction("Index");
    }

    [HttpPost, ValidateAntiForgeryToken]
    public ActionResult PlaceOrder()
    {
        var order = Order.Create(Cart.From(Session), (Address)Session[SessionKeys.Address], db.Products);
        db.Orders.Add(order);
        db.SaveChanges();
        return RedirectToAction("Pay", new { id = order.Id });
    }

    public ActionResult Pay(int id) => Redirect(payments.StartPayment(db.Orders.Find(id), Url.Action("Confirm", null, new { id }, Request.Url.Scheme)));

    public ActionResult Confirm(int id, string reference)
    {
        var order = db.Orders.Find(id);
        if (payments.IsPaid(reference)) { order.Status = OrderStatus.Paid; db.SaveChanges(); Session.Remove(SessionKeys.Cart); }
        return View(order);
    }
}