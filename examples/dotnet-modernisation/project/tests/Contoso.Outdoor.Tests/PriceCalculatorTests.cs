[TestClass]
public class PriceCalculatorTests
{
    [TestMethod]
    public void RoundsVatAwayFromZero() => Assert.AreEqual(12.11m, PriceCalculator.Total(new[] { new CartLine(10.005m, 1) }, 0.21m));
}
